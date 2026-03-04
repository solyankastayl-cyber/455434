/**
 * Rankings V2 Service
 * 
 * Main orchestration service for Rankings V2
 */
import { RankingSnapshotModel, type IRankingSnapshot } from './rankings_v2.model.js';
import { computeRankScoreV2 } from './rank_score.js';
import { computeBucketV2 } from './bucket.js';
import { decideV2 } from '../engine_v2/engine_v2.service.js';
import { EntityModel } from '../entities/entities.model.js';
import type { 
  RankWindow, 
  RankingsV2Input, 
  RankingResult, 
  RankingsSummary,
  TopSignalAttribution 
} from './rankings_v2.types.js';

/**
 * Build Rankings V2 input from Engine V2 decision
 */
function buildRankingsInput(
  engineDecision: Awaited<ReturnType<typeof decideV2>>,
  entity: { id: string; symbol?: string; address?: string },
  window: RankWindow
): RankingsV2Input {
  const attr = engineDecision.attribution;
  const summary = attr.summary;
  
  // Calculate lifecycle mix from signals
  const total = summary.totalSignals || 1;
  const activeShare = summary.activeSignals / total;
  const cooldownShare = (total - summary.activeSignals) * 0.5 / total;
  const resolvedShare = 1 - activeShare - cooldownShare;
  
  // Calculate average signal age (estimate from freshness or default)
  const avgSignalAgeHours = 12; // Default estimate, could be computed from signals
  
  // Map top signals to attribution format
  const topSignals: TopSignalAttribution[] = attr.topSignals.map(s => ({
    signalId: s.signalId,
    kind: s.type || 'unknown',
    contribution: s.contribution,
    confidence: s.confidence,
    ageHours: 12, // Could be computed from signal.updatedAt
    direction: s.direction,
  }));
  
  return {
    subject: {
      kind: 'entity',
      id: entity.id,
      symbol: entity.symbol,
      address: entity.address,
    },
    window,
    
    // Engine V2 scores
    coverage: engineDecision.scores.coverage,
    evidence: engineDecision.scores.evidence,
    direction: engineDecision.scores.direction,
    risk: engineDecision.scores.risk,
    confidence: Math.round(summary.clusterPassRate * 100), // Derived confidence
    
    // Quality metrics
    clusterPassRate: summary.clusterPassRate,
    avgDominance: summary.avgDominance,
    penaltyRate: summary.penaltyRate,
    
    // Activity
    activeSignals: summary.activeSignals,
    lifecycleMix: {
      active: activeShare,
      cooldown: cooldownShare,
      resolved: resolvedShare,
    },
    
    // Freshness
    avgSignalAgeHours,
    freshnessScore: undefined, // Let rank_score compute it
    
    // Attribution
    topSignals,
  };
}

/**
 * Compute ranking for a single entity
 */
export async function computeEntityRanking(
  entityId: string,
  window: RankWindow = '24h'
): Promise<RankingResult | null> {
  // Get Engine V2 decision
  const engineDecision = await decideV2({
    asset: entityId,
    window,
  });
  
  if (!engineDecision.subject) {
    return null;
  }
  
  // Build ranking input
  const input = buildRankingsInput(
    engineDecision,
    {
      id: entityId,
      symbol: engineDecision.subject.name,
      address: engineDecision.subject.ref,
    },
    window
  );
  
  // Compute rank score
  const { score, trace } = computeRankScoreV2(input);
  
  // Compute bucket
  const { bucket, reason } = computeBucketV2({
    rankScore: score,
    risk: input.risk,
    coverage: input.coverage,
    penaltyRate: input.penaltyRate,
  });
  
  const result: RankingResult = {
    subject: input.subject,
    window,
    computedAt: new Date().toISOString(),
    
    rankScore: Number(score.toFixed(2)),
    bucket,
    bucketReason: reason,
    
    engine: {
      coverage: input.coverage,
      evidence: input.evidence,
      direction: input.direction,
      risk: input.risk,
      confidence: input.confidence,
    },
    
    quality: {
      clusterPassRate: input.clusterPassRate,
      avgDominance: input.avgDominance,
      penaltyRate: input.penaltyRate,
      activeSignals: input.activeSignals,
    },
    
    freshness: {
      avgSignalAgeHours: input.avgSignalAgeHours,
      freshnessFactor: trace.freshnessFactor,
    },
    
    lifecycleMix: input.lifecycleMix,
    rankTrace: trace,
    topSignals: input.topSignals,
  };
  
  return result;
}

/**
 * Save ranking snapshot to database
 */
export async function saveRankingSnapshot(result: RankingResult): Promise<void> {
  await RankingSnapshotModel.create({
    subject: result.subject,
    window: result.window,
    computedAt: new Date(result.computedAt),
    rankScore: result.rankScore,
    bucket: result.bucket,
    bucketReason: result.bucketReason,
    engine: result.engine,
    quality: result.quality,
    freshness: result.freshness,
    lifecycleMix: result.lifecycleMix,
    rankTrace: result.rankTrace,
    topSignals: result.topSignals,
    meta: {
      engineVersion: 'v2',
      rankingsVersion: 'v2',
    },
  });
}

/**
 * Compute rankings for all known entities
 */
export async function computeAllRankings(
  window: RankWindow = '24h',
  limit: number = 200
): Promise<{
  results: RankingResult[];
  summary: RankingsSummary;
}> {
  // Get entities from database
  const entities = await EntityModel.find({})
    .select('slug name primaryAddresses')
    .limit(limit)
    .lean();
  
  const results: RankingResult[] = [];
  const summary: RankingsSummary = {
    total: 0,
    BUY: 0,
    WATCH: 0,
    SELL: 0,
    NEUTRAL: 0,
  };
  
  // Process each entity
  for (const entity of entities) {
    try {
      const result = await computeEntityRanking(
        entity.slug || entity.primaryAddresses?.[0] || '',
        window
      );
      
      if (result) {
        results.push(result);
        summary.total++;
        summary[result.bucket]++;
        
        // Save snapshot
        await saveRankingSnapshot(result);
      }
    } catch (err) {
      console.error(`[Rankings V2] Error computing ranking for ${entity.slug}:`, err);
    }
  }
  
  // Sort by rankScore descending
  results.sort((a, b) => b.rankScore - a.rankScore);
  
  return { results, summary };
}

/**
 * Get latest rankings from database
 */
export async function getLatestRankings(
  window: RankWindow = '24h',
  bucket?: string,
  limit: number = 100
): Promise<RankingResult[]> {
  const query: any = { window };
  if (bucket) {
    query.bucket = bucket;
  }
  
  const snapshots = await RankingSnapshotModel.find(query)
    .sort({ rankScore: -1, computedAt: -1 })
    .limit(limit)
    .lean();
  
  return snapshots.map(s => ({
    subject: s.subject,
    window: s.window as RankWindow,
    computedAt: s.computedAt.toISOString(),
    rankScore: s.rankScore,
    bucket: s.bucket as any,
    bucketReason: s.bucketReason || '',
    engine: s.engine,
    quality: s.quality,
    freshness: s.freshness,
    lifecycleMix: s.lifecycleMix,
    rankTrace: s.rankTrace,
    topSignals: s.topSignals || [],
  }));
}

/**
 * Get ranking attribution for a specific token
 */
export async function getRankingAttribution(
  entityId: string,
  window: RankWindow = '24h'
): Promise<RankingResult | null> {
  const snapshot = await RankingSnapshotModel.findOne({
    'subject.id': entityId,
    window,
  })
    .sort({ computedAt: -1 })
    .lean();
  
  if (!snapshot) {
    // Compute fresh if not found
    return computeEntityRanking(entityId, window);
  }
  
  return {
    subject: snapshot.subject,
    window: snapshot.window as RankWindow,
    computedAt: snapshot.computedAt.toISOString(),
    rankScore: snapshot.rankScore,
    bucket: snapshot.bucket as any,
    bucketReason: snapshot.bucketReason || '',
    engine: snapshot.engine,
    quality: snapshot.quality,
    freshness: snapshot.freshness,
    lifecycleMix: snapshot.lifecycleMix,
    rankTrace: snapshot.rankTrace,
    topSignals: snapshot.topSignals || [],
  };
}
