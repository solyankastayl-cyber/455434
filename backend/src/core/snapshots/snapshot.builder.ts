/**
 * ETAP 6.3 — Snapshot Builder Service
 * 
 * Builds immutable snapshots from aggregation data.
 * 
 * Architecture:
 * actor_flow_agg + actor_activity_agg + bridge_agg + edge_flow_agg → snapshot builder → signal_snapshots
 * 
 * Key principles:
 * - Read ONLY from aggregations
 * - Write to signal_snapshots
 * - Immutable (append-only)
 * - Engine reads ONLY from snapshots
 * 
 * P1.4 Enhanced: Snapshot viability checks, coverage metrics, stability tracking
 */
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { ActorModel } from '../actors/actor.model.js';
import { ActorFlowAggModel } from '../aggregation/actor_flow_agg.model.js';
import { ActorActivityAggModel } from '../aggregation/actor_activity_agg.model.js';
import { BridgeAggModel } from '../aggregation/bridge_agg.model.js';
import { EdgeFlowAggModel } from '../aggregation/edge_flow_agg.model.js';
import { SignalSnapshotModel } from './snapshot.model.js';
import type { 
  SignalSnapshot, 
  SnapshotActor, 
  SnapshotEdge, 
  SnapshotStats,
  SnapshotWindow,
} from './snapshot.types.js';

// ==================== TYPES ====================

export interface SnapshotBuildResult {
  snapshotId: string;
  window: SnapshotWindow;
  actorCount: number;
  edgeCount: number;
  duration: number;
  created: boolean;
  message?: string;
  viability?: SnapshotViability; // P1.4
}

// P1.4: Snapshot viability thresholds
export interface SnapshotViabilityThresholds {
  minActors: number;
  minEdges: number;
  minCoveragePct: number;
}

export interface SnapshotViability {
  isViable: boolean;
  actorsCoveragePct: number;
  edgesCoveragePct: number;
  transfersCoveredPct: number;
  quality: 'HIGH' | 'MEDIUM' | 'LOW';
  issues: string[];
}

// P1.4: Thresholds by window
const VIABILITY_THRESHOLDS: Record<SnapshotWindow, SnapshotViabilityThresholds> = {
  '24h': { minActors: 6, minEdges: 4, minCoveragePct: 40 },
  '7d': { minActors: 10, minEdges: 8, minCoveragePct: 40 },
  '30d': { minActors: 15, minEdges: 12, minCoveragePct: 40 },
};

// ==================== BUILDER ====================

/**
 * P1.4: Check snapshot viability
 */
function checkSnapshotViability(
  window: SnapshotWindow,
  actors: SnapshotActor[],
  edges: SnapshotEdge[]
): SnapshotViability {
  const thresholds = VIABILITY_THRESHOLDS[window];
  const issues: string[] = [];
  
  // Check minimum counts
  if (actors.length < thresholds.minActors) {
    issues.push(`Actors: ${actors.length} < ${thresholds.minActors} required`);
  }
  if (edges.length < thresholds.minEdges) {
    issues.push(`Edges: ${edges.length} < ${thresholds.minEdges} required`);
  }
  
  // Calculate coverage percentages
  const actorsWithHighCoverage = actors.filter(a => (a.coverage || 0) >= 60).length;
  const actorsCoveragePct = actors.length > 0 
    ? Math.round((actorsWithHighCoverage / actors.length) * 100) 
    : 0;
    
  const edgesWithHighConfidence = edges.filter(e => (e.confidence || 0) >= 0.5).length;
  const edgesCoveragePct = edges.length > 0 
    ? Math.round((edgesWithHighConfidence / edges.length) * 100) 
    : 0;
  
  // Transfers coverage is proxy - based on tx counts
  const totalTxCount = actors.reduce((sum, a) => sum + (a.tx_count || 0), 0);
  const transfersCoveredPct = Math.min(100, Math.round(totalTxCount / 10)); // Simple proxy
  
  if (actorsCoveragePct < thresholds.minCoveragePct) {
    issues.push(`Actor coverage: ${actorsCoveragePct}% < ${thresholds.minCoveragePct}% required`);
  }
  
  // Determine quality
  let quality: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH';
  if (issues.length > 0) {
    quality = issues.length > 2 ? 'LOW' : 'MEDIUM';
  }
  if (actorsCoveragePct >= 70 && actors.length >= thresholds.minActors * 1.5) {
    quality = 'HIGH';
  }
  
  const isViable = actors.length >= thresholds.minActors && edges.length >= thresholds.minEdges;
  
  return {
    isViable,
    actorsCoveragePct,
    edgesCoveragePct,
    transfersCoveredPct,
    quality,
    issues,
  };
}

/**
 * P1.4: Calculate snapshot hash for stability tracking
 */
function calculateSnapshotHash(actors: SnapshotActor[], edges: SnapshotEdge[]): string {
  const content = JSON.stringify({
    actors: actors.map(a => ({ id: a.actorId, tx: a.tx_count, net: a.net_flow_usd })),
    edges: edges.map(e => ({ s: e.sourceId, t: e.targetId, w: e.weight })),
  });
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Build a snapshot for a window
 * 
 * Reads from aggregation collections and creates immutable snapshot.
 * Only creates if aggregations have been updated since last snapshot.
 */
export async function buildSnapshot(window: SnapshotWindow): Promise<SnapshotBuildResult> {
  const startTime = Date.now();
  const snapshotId = `snapshot_${window}_${uuidv4().substring(0, 8)}`;
  const snapshotAt = new Date();

  console.log(`[Snapshot] Building snapshot for window: ${window}`);

  try {
    // Check if we need to create a new snapshot
    const lastSnapshot = await SignalSnapshotModel
      .findOne({ window })
      .sort({ snapshotAt: -1 })
      .lean();

    // Get latest aggregation update times
    const [latestFlow, latestActivity] = await Promise.all([
      ActorFlowAggModel.findOne({ window }).sort({ updatedAt: -1 }).lean(),
      ActorActivityAggModel.findOne({ window }).sort({ updatedAt: -1 }).lean(),
    ]);

    // Skip if no new aggregations
    if (lastSnapshot && latestFlow && latestActivity) {
      const lastSnapshotTime = lastSnapshot.snapshotAt.getTime();
      const latestAggTime = Math.max(
        latestFlow.updatedAt?.getTime() || 0,
        latestActivity.updatedAt?.getTime() || 0
      );

      if (latestAggTime <= lastSnapshotTime) {
        return {
          snapshotId: lastSnapshot.snapshotId,
          window,
          actorCount: lastSnapshot.stats.actorCount,
          edgeCount: lastSnapshot.stats.edgeCount,
          duration: Date.now() - startTime,
          created: false,
          message: 'No new aggregations since last snapshot',
        };
      }
    }

    // Load actor metadata for enrichment
    const actorMetadata = new Map<string, { name?: string; type?: string; coverage?: number }>();
    const actors = await ActorModel.find({}).lean();
    for (const actor of actors) {
      actorMetadata.set(actor.id, {
        name: actor.name,
        type: actor.type,
        coverage: actor.coverage?.score || 0,
      });
    }

    // Load flow aggregates
    const flowAggs = await ActorFlowAggModel.find({ window }).lean();
    
    // Load activity aggregates
    const activityAggs = await ActorActivityAggModel.find({ window }).lean();
    const activityMap = new Map(activityAggs.map(a => [a.actorId, a]));

    // Build snapshot actors
    const snapshotActors: SnapshotActor[] = [];
    let totalVolume = 0;
    let totalBurstScore = 0;

    for (const flow of flowAggs) {
      const activity = activityMap.get(flow.actorId);
      const metadata = actorMetadata.get(flow.actorId);

      snapshotActors.push({
        actorId: flow.actorId,
        name: metadata?.name,
        type: metadata?.type,
        
        inflow_usd: flow.inflow_usd,
        outflow_usd: flow.outflow_usd,
        net_flow_usd: flow.net_flow_usd,
        tx_count: flow.tx_count,
        
        participation_trend: activity?.participation_trend || 'stable',
        burst_score: activity?.burst_score || 0,
        
        coverage: metadata?.coverage || 0,
      });

      totalVolume += flow.inflow_usd + flow.outflow_usd;
      totalBurstScore += activity?.burst_score || 0;
    }

    // Load bridge aggregates → edges
    const bridgeAggs = await BridgeAggModel.find({ window }).lean();
    
    // P1.4: Also include edge_flow_agg for better edges
    const edgeFlowAggs = await EdgeFlowAggModel.find({ window }).lean();
    
    const snapshotEdges: SnapshotEdge[] = bridgeAggs.map(bridge => ({
      sourceId: bridge.entityA,
      targetId: bridge.entityB,
      edgeType: bridge.token_overlap > 0.5 ? 'bridge' : 'flow',
      
      weight: bridge.flow_overlap,
      confidence: Math.max(bridge.temporal_sync, bridge.token_overlap),
      direction_balance: bridge.direction_balance,
      evidence_count: bridge.evidence_count,
    }));
    
    // P1.4: Add edges from edge_flow_agg that aren't in bridges
    const edgeKeys = new Set(snapshotEdges.map(e => `${e.sourceId}:${e.targetId}`));
    for (const edge of edgeFlowAggs) {
      const key = `${edge.fromActorId}:${edge.toActorId}`;
      const reverseKey = `${edge.toActorId}:${edge.fromActorId}`;
      if (!edgeKeys.has(key) && !edgeKeys.has(reverseKey)) {
        snapshotEdges.push({
          sourceId: edge.fromActorId,
          targetId: edge.toActorId,
          edgeType: 'flow',
          weight: edge.flow_usd,
          confidence: edge.confidence / 100, // Normalize to 0-1
          direction_balance: edge.direction === 'BI' ? 0 : (edge.direction === 'OUT' ? -1 : 1),
          evidence_count: edge.tx_count,
        });
        edgeKeys.add(key);
      }
    }

    // P1.4: Check viability
    const viability = checkSnapshotViability(window, snapshotActors, snapshotEdges);

    // Build stats
    const stats: SnapshotStats = {
      actorCount: snapshotActors.length,
      edgeCount: snapshotEdges.length,
      totalVolume,
      avgBurstScore: snapshotActors.length > 0 
        ? Math.round(totalBurstScore / snapshotActors.length) 
        : 0,
    };

    // P1.4: Calculate hash for stability tracking
    const snapshotHash = calculateSnapshotHash(snapshotActors, snapshotEdges);

    // Create snapshot document with P1.4 fields
    await SignalSnapshotModel.create({
      snapshotId,
      window,
      snapshotAt,
      actors: snapshotActors,
      edges: snapshotEdges,
      stats,
      // P1.4 fields
      coverage: {
        actorsCoveragePct: viability.actorsCoveragePct,
        edgesCoveragePct: viability.edgesCoveragePct,
        transfersCoveredPct: viability.transfersCoveredPct,
      },
      stability: {
        snapshotHash,
        isStable: true, // Will be updated on subsequent builds
        quality: viability.quality,
      },
      isViable: viability.isViable,
      createdAt: new Date(),
    });

    console.log(
      `[Snapshot] ${window} created: ${stats.actorCount} actors, ${stats.edgeCount} edges, viability=${viability.isViable}, quality=${viability.quality} (${Date.now() - startTime}ms)`
    );

    return {
      snapshotId,
      window,
      actorCount: stats.actorCount,
      edgeCount: stats.edgeCount,
      duration: Date.now() - startTime,
      created: true,
      viability,
    };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Snapshot] Build failed: ${message}`);
    
    return {
      snapshotId,
      window,
      actorCount: 0,
      edgeCount: 0,
      duration: Date.now() - startTime,
      created: false,
      message,
    };
  }
}

// ==================== QUERIES ====================

/**
 * Get latest snapshot for a window
 */
export async function getLatestSnapshot(window: SnapshotWindow): Promise<SignalSnapshot | null> {
  const snapshot = await SignalSnapshotModel
    .findOne({ window })
    .sort({ snapshotAt: -1 })
    .lean();

  if (!snapshot) return null;

  return {
    snapshotId: snapshot.snapshotId,
    window: snapshot.window as SnapshotWindow,
    snapshotAt: snapshot.snapshotAt,
    actors: snapshot.actors,
    edges: snapshot.edges,
    stats: snapshot.stats,
    createdAt: snapshot.createdAt,
  };
}

/**
 * Get snapshot by ID
 */
export async function getSnapshotById(snapshotId: string): Promise<SignalSnapshot | null> {
  const snapshot = await SignalSnapshotModel
    .findOne({ snapshotId })
    .lean();

  if (!snapshot) return null;

  return {
    snapshotId: snapshot.snapshotId,
    window: snapshot.window as SnapshotWindow,
    snapshotAt: snapshot.snapshotAt,
    actors: snapshot.actors,
    edges: snapshot.edges,
    stats: snapshot.stats,
    createdAt: snapshot.createdAt,
  };
}

/**
 * List snapshots for a window
 */
export async function listSnapshots(
  window: SnapshotWindow,
  limit = 10
): Promise<Array<{
  snapshotId: string;
  window: string;
  snapshotAt: Date;
  actorCount: number;
  edgeCount: number;
}>> {
  const snapshots = await SignalSnapshotModel
    .find({ window })
    .sort({ snapshotAt: -1 })
    .limit(limit)
    .select('snapshotId window snapshotAt stats')
    .lean();

  return snapshots.map(s => ({
    snapshotId: s.snapshotId,
    window: s.window,
    snapshotAt: s.snapshotAt,
    actorCount: s.stats.actorCount,
    edgeCount: s.stats.edgeCount,
  }));
}

/**
 * Get snapshot stats for all windows
 */
export async function getSnapshotStats(): Promise<{
  windows: Record<SnapshotWindow, {
    count: number;
    latest: {
      snapshotId: string;
      snapshotAt: string;
      actorCount: number;
      edgeCount: number;
    } | null;
  }>;
}> {
  const windows: SnapshotWindow[] = ['24h', '7d', '30d'];
  const result: Record<SnapshotWindow, {
    count: number;
    latest: { snapshotId: string; snapshotAt: string; actorCount: number; edgeCount: number } | null;
  }> = {
    '24h': { count: 0, latest: null },
    '7d': { count: 0, latest: null },
    '30d': { count: 0, latest: null },
  };

  for (const window of windows) {
    const [count, latest] = await Promise.all([
      SignalSnapshotModel.countDocuments({ window }),
      SignalSnapshotModel.findOne({ window }).sort({ snapshotAt: -1 }).lean(),
    ]);

    result[window] = {
      count,
      latest: latest ? {
        snapshotId: latest.snapshotId,
        snapshotAt: latest.snapshotAt.toISOString(),
        actorCount: latest.stats.actorCount,
        edgeCount: latest.stats.edgeCount,
      } : null,
    };
  }

  return { windows: result };
}

/**
 * Cleanup old snapshots (keep last N per window)
 */
export async function cleanupOldSnapshots(keepCount = 10): Promise<number> {
  const windows: SnapshotWindow[] = ['24h', '7d', '30d'];
  let totalDeleted = 0;

  for (const window of windows) {
    const snapshots = await SignalSnapshotModel
      .find({ window })
      .sort({ snapshotAt: -1 })
      .skip(keepCount)
      .select('_id')
      .lean();

    if (snapshots.length > 0) {
      const result = await SignalSnapshotModel.deleteMany({
        _id: { $in: snapshots.map(s => s._id) },
      });
      totalDeleted += result.deletedCount;
    }
  }

  if (totalDeleted > 0) {
    console.log(`[Snapshot] Cleaned up ${totalDeleted} old snapshots`);
  }

  return totalDeleted;
}
