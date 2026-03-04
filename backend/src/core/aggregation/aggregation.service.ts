/**
 * ETAP 6.2 — Aggregation Service
 * 
 * Core service for computing aggregates from raw_transfers.
 * 
 * Architecture:
 * raw_transfers → aggregation jobs → actor_flow_agg / actor_activity_agg / bridge_agg / edge_flow_agg
 * 
 * Key principles:
 * - Read ONLY from raw_transfers
 * - Write to agg collections
 * - Idempotent (upsert)
 * - Incremental (by window)
 * - NO mutations to raw data
 * 
 * P1.2 Enhanced: edge_flow_agg, direction metrics
 */
import { ActorModel } from '../actors/actor.model.js';
import { RawTransferModel } from '../ingest/raw_transfer.model.js';
import { ActorFlowAggModel, IActorFlowAgg } from './actor_flow_agg.model.js';
import { ActorActivityAggModel, ParticipationTrend } from './actor_activity_agg.model.js';
import { BridgeAggModel } from './bridge_agg.model.js';
import { EdgeFlowAggModel, calculateEdgeConfidence } from './edge_flow_agg.model.js';

// ==================== TYPES ====================

export type AggWindow = '24h' | '7d' | '30d';

export interface AggregationResult {
  window: AggWindow;
  actorFlowsUpdated: number;
  actorActivitiesUpdated: number;
  bridgesUpdated: number;
  edgeFlowsUpdated: number;      // P1.2
  duration: number;
  errors: string[];
}

export interface AggregationRunRecord {
  runId: string;
  window: AggWindow;
  startedAt: Date;
  finishedAt: Date | null;
  actorFlowsUpdated: number;
  actorActivitiesUpdated: number;
  bridgesUpdated: number;
  status: 'running' | 'completed' | 'failed';
  errors: string[];
}

// ==================== HELPERS ====================

/**
 * Get window start date
 */
function getWindowStart(window: AggWindow): Date {
  const now = new Date();
  switch (window) {
    case '24h':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
}

/**
 * Normalize entity pair for consistent ordering
 */
function normalizeEntityPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Build address → actorId map
 */
async function buildAddressActorMap(): Promise<Map<string, string>> {
  const actors = await ActorModel.find({
    sourceLevel: { $in: ['verified', 'attributed'] },
    addresses: { $exists: true, $ne: [] },
  }).lean();

  const map = new Map<string, string>();
  for (const actor of actors) {
    for (const addr of actor.addresses || []) {
      map.set(addr.toLowerCase(), actor.id);
    }
  }

  console.log(`[Aggregation] Built address→actor map: ${map.size} addresses`);
  return map;
}

// ==================== 6.2.1 ACTOR FLOW AGGREGATION ====================

/**
 * Aggregate actor flows from raw_transfers
 */
export async function aggregateActorFlows(window: AggWindow): Promise<{
  updated: number;
  errors: string[];
}> {
  const windowStart = getWindowStart(window);
  const addressActorMap = await buildAddressActorMap();
  const errors: string[] = [];

  if (addressActorMap.size === 0) {
    return { updated: 0, errors: ['No actors with addresses found'] };
  }

  // Get all addresses we're tracking
  const trackedAddresses = Array.from(addressActorMap.keys());

  // Aggregate inflows (to = actor address)
  const inflowPipeline = [
    {
      $match: {
        blockTime: { $gte: windowStart },
        to: { $in: trackedAddresses },
      },
    },
    {
      $group: {
        _id: '$to',
        inflow_count: { $sum: 1 },
        tokens: { $addToSet: '$token' },
        counterparties: { $addToSet: '$from' },
        first_seen: { $min: '$blockTime' },
        last_seen: { $max: '$blockTime' },
      },
    },
  ];

  // Aggregate outflows (from = actor address)
  const outflowPipeline = [
    {
      $match: {
        blockTime: { $gte: windowStart },
        from: { $in: trackedAddresses },
      },
    },
    {
      $group: {
        _id: '$from',
        outflow_count: { $sum: 1 },
        tokens: { $addToSet: '$token' },
        counterparties: { $addToSet: '$to' },
        first_seen: { $min: '$blockTime' },
        last_seen: { $max: '$blockTime' },
      },
    },
  ];

  try {
    const [inflows, outflows] = await Promise.all([
      RawTransferModel.aggregate(inflowPipeline),
      RawTransferModel.aggregate(outflowPipeline),
    ]);

    // Build per-actor aggregates
    const actorStats = new Map<string, {
      inflow_count: number;
      outflow_count: number;
      tokens: Set<string>;
      counterparties: Set<string>;
      first_seen: Date | null;
      last_seen: Date | null;
    }>();

    // Process inflows
    for (const inflow of inflows) {
      const actorId = addressActorMap.get(inflow._id);
      if (!actorId) continue;

      if (!actorStats.has(actorId)) {
        actorStats.set(actorId, {
          inflow_count: 0,
          outflow_count: 0,
          tokens: new Set(),
          counterparties: new Set(),
          first_seen: null,
          last_seen: null,
        });
      }

      const stats = actorStats.get(actorId)!;
      stats.inflow_count += inflow.inflow_count;
      inflow.tokens.forEach((t: string) => stats.tokens.add(t));
      inflow.counterparties.forEach((c: string) => stats.counterparties.add(c));
      
      if (!stats.first_seen || inflow.first_seen < stats.first_seen) {
        stats.first_seen = inflow.first_seen;
      }
      if (!stats.last_seen || inflow.last_seen > stats.last_seen) {
        stats.last_seen = inflow.last_seen;
      }
    }

    // Process outflows
    for (const outflow of outflows) {
      const actorId = addressActorMap.get(outflow._id);
      if (!actorId) continue;

      if (!actorStats.has(actorId)) {
        actorStats.set(actorId, {
          inflow_count: 0,
          outflow_count: 0,
          tokens: new Set(),
          counterparties: new Set(),
          first_seen: null,
          last_seen: null,
        });
      }

      const stats = actorStats.get(actorId)!;
      stats.outflow_count += outflow.outflow_count;
      outflow.tokens.forEach((t: string) => stats.tokens.add(t));
      outflow.counterparties.forEach((c: string) => stats.counterparties.add(c));
      
      if (!stats.first_seen || outflow.first_seen < stats.first_seen) {
        stats.first_seen = outflow.first_seen;
      }
      if (!stats.last_seen || outflow.last_seen > stats.last_seen) {
        stats.last_seen = outflow.last_seen;
      }
    }

    // Upsert actor flow aggregates
    const bulkOps = [];
    for (const [actorId, stats] of actorStats) {
      // Note: USD values would need price oracle - for now using tx counts as proxy
      const inflowUsd = stats.inflow_count * 1000; // placeholder
      const outflowUsd = stats.outflow_count * 1000; // placeholder
      
      bulkOps.push({
        updateOne: {
          filter: { actorId, window },
          update: {
            $set: {
              actorId,
              window,
              inflow_usd: inflowUsd,
              outflow_usd: outflowUsd,
              net_flow_usd: inflowUsd - outflowUsd,
              tx_count: stats.inflow_count + stats.outflow_count,
              unique_tokens: stats.tokens.size,
              unique_counterparties: stats.counterparties.size,
              first_seen: stats.first_seen,
              last_seen: stats.last_seen,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length > 0) {
      await ActorFlowAggModel.bulkWrite(bulkOps, { ordered: false });
    }

    console.log(`[Aggregation] Actor flows ${window}: ${bulkOps.length} actors updated`);
    return { updated: bulkOps.length, errors };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    console.error(`[Aggregation] Actor flows failed: ${message}`);
    return { updated: 0, errors };
  }
}

// ==================== 6.2.2 ACTOR ACTIVITY AGGREGATION ====================

/**
 * Aggregate actor activity patterns
 */
export async function aggregateActorActivity(window: AggWindow): Promise<{
  updated: number;
  errors: string[];
}> {
  const windowStart = getWindowStart(window);
  const addressActorMap = await buildAddressActorMap();
  const errors: string[] = [];

  if (addressActorMap.size === 0) {
    return { updated: 0, errors: ['No actors with addresses found'] };
  }

  const trackedAddresses = Array.from(addressActorMap.keys());

  // Aggregate daily activity
  const activityPipeline = [
    {
      $match: {
        blockTime: { $gte: windowStart },
        $or: [
          { from: { $in: trackedAddresses } },
          { to: { $in: trackedAddresses } },
        ],
      },
    },
    {
      $project: {
        from: 1,
        to: 1,
        day: { $dateToString: { format: '%Y-%m-%d', date: '$blockTime' } },
      },
    },
    {
      $facet: {
        fromActivity: [
          { $match: { from: { $in: trackedAddresses } } },
          { $group: { _id: { addr: '$from', day: '$day' }, count: { $sum: 1 } } },
        ],
        toActivity: [
          { $match: { to: { $in: trackedAddresses } } },
          { $group: { _id: { addr: '$to', day: '$day' }, count: { $sum: 1 } } },
        ],
      },
    },
  ];

  try {
    const [result] = await RawTransferModel.aggregate(activityPipeline);
    
    // Build per-actor daily activity
    const actorDailyTx = new Map<string, Map<string, number>>();

    // Process from activity
    for (const item of result.fromActivity) {
      const actorId = addressActorMap.get(item._id.addr);
      if (!actorId) continue;

      if (!actorDailyTx.has(actorId)) {
        actorDailyTx.set(actorId, new Map());
      }
      const daily = actorDailyTx.get(actorId)!;
      daily.set(item._id.day, (daily.get(item._id.day) || 0) + item.count);
    }

    // Process to activity
    for (const item of result.toActivity) {
      const actorId = addressActorMap.get(item._id.addr);
      if (!actorId) continue;

      if (!actorDailyTx.has(actorId)) {
        actorDailyTx.set(actorId, new Map());
      }
      const daily = actorDailyTx.get(actorId)!;
      daily.set(item._id.day, (daily.get(item._id.day) || 0) + item.count);
    }

    // Calculate activity metrics
    const bulkOps = [];
    for (const [actorId, daily] of actorDailyTx) {
      const days = Array.from(daily.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const activeDays = days.length;
      const txCounts = days.map(d => d[1]);
      
      const totalTx = txCounts.reduce((a, b) => a + b, 0);
      const avgTxPerDay = activeDays > 0 ? totalTx / activeDays : 0;
      const peakTxDay = Math.max(...txCounts, 0);

      // Calculate trend (simple linear regression slope)
      let trend: ParticipationTrend = 'stable';
      if (txCounts.length >= 2) {
        const n = txCounts.length;
        const xMean = (n - 1) / 2;
        const yMean = totalTx / n;
        
        let numerator = 0;
        let denominator = 0;
        for (let i = 0; i < n; i++) {
          numerator += (i - xMean) * (txCounts[i] - yMean);
          denominator += (i - xMean) ** 2;
        }
        
        const slope = denominator !== 0 ? numerator / denominator : 0;
        const threshold = yMean * 0.1; // 10% change threshold
        
        if (slope > threshold) trend = 'increasing';
        else if (slope < -threshold) trend = 'decreasing';
      }

      // Calculate burst score (coefficient of variation)
      let burstScore = 0;
      if (txCounts.length > 1 && avgTxPerDay > 0) {
        const variance = txCounts.reduce((sum, x) => sum + (x - avgTxPerDay) ** 2, 0) / txCounts.length;
        const stdDev = Math.sqrt(variance);
        burstScore = Math.min(100, Math.round((stdDev / avgTxPerDay) * 50));
      }

      bulkOps.push({
        updateOne: {
          filter: { actorId, window },
          update: {
            $set: {
              actorId,
              window,
              active_days: activeDays,
              avg_tx_per_day: Math.round(avgTxPerDay * 100) / 100,
              peak_tx_day: peakTxDay,
              participation_trend: trend,
              burst_score: burstScore,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length > 0) {
      await ActorActivityAggModel.bulkWrite(bulkOps, { ordered: false });
    }

    console.log(`[Aggregation] Actor activity ${window}: ${bulkOps.length} actors updated`);
    return { updated: bulkOps.length, errors };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    console.error(`[Aggregation] Actor activity failed: ${message}`);
    return { updated: 0, errors };
  }
}

// ==================== 6.2.3 BRIDGE AGGREGATION ====================

/**
 * Aggregate bridge/cross-entity relationships
 */
export async function aggregateBridges(window: AggWindow): Promise<{
  updated: number;
  errors: string[];
}> {
  const windowStart = getWindowStart(window);
  const addressActorMap = await buildAddressActorMap();
  const errors: string[] = [];

  if (addressActorMap.size === 0) {
    return { updated: 0, errors: ['No actors with addresses found'] };
  }

  const trackedAddresses = Array.from(addressActorMap.keys());

  // Find direct transfers between tracked actors
  const bridgePipeline = [
    {
      $match: {
        blockTime: { $gte: windowStart },
        from: { $in: trackedAddresses },
        to: { $in: trackedAddresses },
      },
    },
    {
      $group: {
        _id: { from: '$from', to: '$to' },
        tx_count: { $sum: 1 },
        tokens: { $addToSet: '$token' },
        first_tx: { $min: '$blockTime' },
        last_tx: { $max: '$blockTime' },
      },
    },
  ];

  try {
    const transfers = await RawTransferModel.aggregate(bridgePipeline);

    // Build entity pair aggregates
    const entityPairs = new Map<string, {
      flowA_to_B: number;
      flowB_to_A: number;
      tokensA: Set<string>;
      tokensB: Set<string>;
      txTimes: Date[];
      evidence_count: number;
    }>();

    for (const tx of transfers) {
      const actorA = addressActorMap.get(tx._id.from);
      const actorB = addressActorMap.get(tx._id.to);
      
      if (!actorA || !actorB || actorA === actorB) continue;

      const [entityA, entityB] = normalizeEntityPair(actorA, actorB);
      const key = `${entityA}:${entityB}`;

      if (!entityPairs.has(key)) {
        entityPairs.set(key, {
          flowA_to_B: 0,
          flowB_to_A: 0,
          tokensA: new Set(),
          tokensB: new Set(),
          txTimes: [],
          evidence_count: 0,
        });
      }

      const pair = entityPairs.get(key)!;
      pair.evidence_count += tx.tx_count;
      
      // Track directional flow
      if (actorA === entityA) {
        pair.flowA_to_B += tx.tx_count;
        tx.tokens.forEach((t: string) => pair.tokensA.add(t));
      } else {
        pair.flowB_to_A += tx.tx_count;
        tx.tokens.forEach((t: string) => pair.tokensB.add(t));
      }

      pair.txTimes.push(tx.first_tx, tx.last_tx);
    }

    // Calculate metrics and upsert
    const bulkOps = [];
    for (const [key, pair] of entityPairs) {
      const [entityA, entityB] = key.split(':');
      
      // Flow overlap (shared activity)
      const flowOverlap = (pair.flowA_to_B + pair.flowB_to_A) * 1000; // proxy USD
      
      // Token overlap (Jaccard index)
      const allTokens = new Set([...pair.tokensA, ...pair.tokensB]);
      const sharedTokens = [...pair.tokensA].filter(t => pair.tokensB.has(t));
      const tokenOverlap = allTokens.size > 0 ? sharedTokens.length / allTokens.size : 0;

      // Direction balance (-1 = all A→B, 0 = balanced, 1 = all B→A)
      const totalFlow = pair.flowA_to_B + pair.flowB_to_A;
      const directionBalance = totalFlow > 0 
        ? (pair.flowB_to_A - pair.flowA_to_B) / totalFlow 
        : 0;

      // Temporal sync (simple: if activity spread is low, high sync)
      const sortedTimes = pair.txTimes.sort((a, b) => a.getTime() - b.getTime());
      let temporalSync = 0;
      if (sortedTimes.length >= 2) {
        const timeSpan = sortedTimes[sortedTimes.length - 1].getTime() - sortedTimes[0].getTime();
        const windowMs = window === '24h' ? 86400000 : window === '7d' ? 604800000 : 2592000000;
        temporalSync = 1 - Math.min(1, timeSpan / windowMs);
      }

      bulkOps.push({
        updateOne: {
          filter: { entityA, entityB, window },
          update: {
            $set: {
              entityA,
              entityB,
              window,
              flow_overlap: Math.round(flowOverlap),
              temporal_sync: Math.round(temporalSync * 100) / 100,
              token_overlap: Math.round(tokenOverlap * 100) / 100,
              direction_balance: Math.round(directionBalance * 100) / 100,
              evidence_count: pair.evidence_count,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length > 0) {
      await BridgeAggModel.bulkWrite(bulkOps, { ordered: false });
    }

    console.log(`[Aggregation] Bridges ${window}: ${bulkOps.length} pairs updated`);
    return { updated: bulkOps.length, errors };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    console.error(`[Aggregation] Bridges failed: ${message}`);
    return { updated: 0, errors };
  }
}

// ==================== P1.2 EDGE FLOW AGGREGATION ====================

/**
 * P1.2: Aggregate edge flows between actor pairs
 * Used for NEW_CORRIDOR and DENSITY_SPIKE detection
 */
export async function aggregateEdgeFlows(window: AggWindow): Promise<{
  updated: number;
  errors: string[];
}> {
  const windowStart = getWindowStart(window);
  const addressActorMap = await buildAddressActorMap();
  const errors: string[] = [];

  if (addressActorMap.size === 0) {
    return { updated: 0, errors: ['No actors with addresses found'] };
  }

  const trackedAddresses = Array.from(addressActorMap.keys());

  // Find direct transfers between tracked actors
  const edgePipeline = [
    {
      $match: {
        blockTime: { $gte: windowStart },
        from: { $in: trackedAddresses },
        to: { $in: trackedAddresses },
      },
    },
    {
      $group: {
        _id: { from: '$from', to: '$to' },
        tx_count: { $sum: 1 },
        tokens: { $addToSet: '$token' },
        first_seen: { $min: '$blockTime' },
        last_seen: { $max: '$blockTime' },
      },
    },
  ];

  try {
    const transfers = await RawTransferModel.aggregate(edgePipeline);

    // Build edge aggregates (directional: from → to)
    const edges = new Map<string, {
      fromActorId: string;
      toActorId: string;
      tx_count: number;
      tokens: Set<string>;
      first_seen: Date;
      last_seen: Date;
    }>();

    for (const tx of transfers) {
      const fromActorId = addressActorMap.get(tx._id.from);
      const toActorId = addressActorMap.get(tx._id.to);
      
      if (!fromActorId || !toActorId || fromActorId === toActorId) continue;

      const key = `${fromActorId}→${toActorId}`;

      if (!edges.has(key)) {
        edges.set(key, {
          fromActorId,
          toActorId,
          tx_count: 0,
          tokens: new Set(),
          first_seen: tx.first_seen,
          last_seen: tx.last_seen,
        });
      }

      const edge = edges.get(key)!;
      edge.tx_count += tx.tx_count;
      tx.tokens.forEach((t: string) => edge.tokens.add(t));
      
      if (tx.first_seen < edge.first_seen) edge.first_seen = tx.first_seen;
      if (tx.last_seen > edge.last_seen) edge.last_seen = tx.last_seen;
    }

    // Upsert edges
    const bulkOps = [];
    for (const [_, edge] of edges) {
      // Determine direction based on reverse edge
      const reverseKey = `${edge.toActorId}→${edge.fromActorId}`;
      const reverseEdge = edges.get(reverseKey);
      
      let direction: 'IN' | 'OUT' | 'BI' = 'OUT';
      if (reverseEdge && reverseEdge.tx_count > 0) {
        const ratio = edge.tx_count / (edge.tx_count + reverseEdge.tx_count);
        if (ratio > 0.7) direction = 'OUT';
        else if (ratio < 0.3) direction = 'IN';
        else direction = 'BI';
      }

      const flowUsd = edge.tx_count * 1000; // Placeholder - needs price oracle
      const confidence = calculateEdgeConfidence(edge.tx_count, flowUsd);
      
      const tokenList = Array.from(edge.tokens);
      const dominantToken = tokenList.length > 0 ? tokenList[0] : undefined;

      bulkOps.push({
        updateOne: {
          filter: { 
            fromActorId: edge.fromActorId, 
            toActorId: edge.toActorId, 
            window 
          },
          update: {
            $set: {
              fromActorId: edge.fromActorId,
              toActorId: edge.toActorId,
              window,
              flow_usd: flowUsd,
              tx_count: edge.tx_count,
              direction,
              confidence,
              tokens: tokenList,
              dominant_token: dominantToken,
              first_seen: edge.first_seen,
              last_seen: edge.last_seen,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length > 0) {
      await EdgeFlowAggModel.bulkWrite(bulkOps, { ordered: false });
    }

    console.log(`[Aggregation] Edge flows ${window}: ${bulkOps.length} edges updated`);
    return { updated: bulkOps.length, errors };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    console.error(`[Aggregation] Edge flows failed: ${message}`);
    return { updated: 0, errors };
  }
}

/**
 * P1.2: Update direction metrics on actor flow aggregates
 */
export async function updateDirectionMetrics(window: AggWindow): Promise<{
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  
  try {
    const flows = await ActorFlowAggModel.find({ window });
    const bulkOps = [];
    
    for (const flow of flows) {
      const inflow = flow.inflow_usd || 0;
      const outflow = flow.outflow_usd || 0;
      const epsilon = 1; // Avoid division by zero
      
      // Direction ratio: > 1 means more inflow, < 1 means more outflow
      const directionRatio = (inflow + epsilon) / (outflow + epsilon);
      
      // Imbalance score: 0 = balanced, 100 = highly imbalanced
      const totalFlow = inflow + outflow;
      let imbalanceScore = 50; // Default balanced
      if (totalFlow > 0) {
        const imbalance = Math.abs(inflow - outflow) / totalFlow;
        imbalanceScore = Math.round(imbalance * 100);
      }
      
      // Get inflow/outflow actors from edge_flow_agg
      const [inflowEdges, outflowEdges] = await Promise.all([
        EdgeFlowAggModel.find({ toActorId: flow.actorId, window }).distinct('fromActorId'),
        EdgeFlowAggModel.find({ fromActorId: flow.actorId, window }).distinct('toActorId'),
      ]);
      
      bulkOps.push({
        updateOne: {
          filter: { actorId: flow.actorId, window },
          update: {
            $set: {
              direction_ratio: Math.round(directionRatio * 100) / 100,
              imbalance_score: imbalanceScore,
              inflow_actors: inflowEdges.slice(0, 20), // Limit to top 20
              outflow_actors: outflowEdges.slice(0, 20),
              inflow_tx_count: flow.tx_count || 0, // Simplified - would need separate counts
              outflow_tx_count: flow.tx_count || 0,
              updatedAt: new Date(),
            },
          },
        },
      });
    }
    
    if (bulkOps.length > 0) {
      await ActorFlowAggModel.bulkWrite(bulkOps, { ordered: false });
    }
    
    console.log(`[Aggregation] Direction metrics ${window}: ${bulkOps.length} actors updated`);
    return { updated: bulkOps.length, errors };
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    console.error(`[Aggregation] Direction metrics failed: ${message}`);
    return { updated: 0, errors };
  }
}

// ==================== MAIN AGGREGATION RUNNER ====================

/**
 * Run all aggregations for a window
 */
export async function runAggregation(window: AggWindow): Promise<AggregationResult> {
  const startTime = Date.now();
  const allErrors: string[] = [];

  console.log(`[Aggregation] Starting aggregation for window: ${window}`);

  // Run all aggregations
  const [flowResult, activityResult, bridgeResult, edgeResult] = await Promise.all([
    aggregateActorFlows(window),
    aggregateActorActivity(window),
    aggregateBridges(window),
    aggregateEdgeFlows(window),
  ]);

  allErrors.push(...flowResult.errors, ...activityResult.errors, ...bridgeResult.errors, ...edgeResult.errors);

  // P1.2: Update direction metrics after edge flows are computed
  const directionResult = await updateDirectionMetrics(window);
  allErrors.push(...directionResult.errors);

  const result: AggregationResult = {
    window,
    actorFlowsUpdated: flowResult.updated,
    actorActivitiesUpdated: activityResult.updated,
    bridgesUpdated: bridgeResult.updated,
    edgeFlowsUpdated: edgeResult.updated,
    duration: Date.now() - startTime,
    errors: allErrors,
  };

  console.log(
    `[Aggregation] ${window} complete: flows=${flowResult.updated}, activity=${activityResult.updated}, bridges=${bridgeResult.updated}, edges=${edgeResult.updated} (${result.duration}ms)`
  );

  return result;
}

// ==================== QUERIES ====================

/**
 * Get actor flow aggregates
 */
export async function getActorFlows(window: AggWindow, limit = 100): Promise<IActorFlowAgg[]> {
  return ActorFlowAggModel
    .find({ window })
    .sort({ net_flow_usd: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get actor activity aggregates
 */
export async function getActorActivities(window: AggWindow, limit = 100) {
  return ActorActivityAggModel
    .find({ window })
    .sort({ burst_score: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get bridge aggregates
 */
export async function getBridges(window: AggWindow, limit = 100) {
  return BridgeAggModel
    .find({ window })
    .sort({ flow_overlap: -1 })
    .limit(limit)
    .lean();
}

/**
 * P1.2: Get edge flow aggregates
 */
export async function getEdgeFlows(window: AggWindow, limit = 100) {
  return EdgeFlowAggModel
    .find({ window })
    .sort({ tx_count: -1 })
    .limit(limit)
    .lean();
}

/**
 * P1.2: Get edges for a specific actor
 */
export async function getActorEdges(actorId: string, window: AggWindow) {
  const [outgoing, incoming] = await Promise.all([
    EdgeFlowAggModel.find({ fromActorId: actorId, window }).lean(),
    EdgeFlowAggModel.find({ toActorId: actorId, window }).lean(),
  ]);
  return { outgoing, incoming };
}

/**
 * Get aggregation stats
 */
export async function getAggregationStats(): Promise<{
  windows: Record<AggWindow, {
    actorFlows: number;
    actorActivities: number;
    bridges: number;
    edgeFlows: number;
  }>;
}> {
  const windows: AggWindow[] = ['24h', '7d', '30d'];
  const stats: Record<AggWindow, { actorFlows: number; actorActivities: number; bridges: number; edgeFlows: number }> = {
    '24h': { actorFlows: 0, actorActivities: 0, bridges: 0, edgeFlows: 0 },
    '7d': { actorFlows: 0, actorActivities: 0, bridges: 0, edgeFlows: 0 },
    '30d': { actorFlows: 0, actorActivities: 0, bridges: 0, edgeFlows: 0 },
  };

  for (const window of windows) {
    const [flows, activities, bridges, edges] = await Promise.all([
      ActorFlowAggModel.countDocuments({ window }),
      ActorActivityAggModel.countDocuments({ window }),
      BridgeAggModel.countDocuments({ window }),
      EdgeFlowAggModel.countDocuments({ window }),
    ]);
    stats[window] = { actorFlows: flows, actorActivities: activities, bridges: bridges, edgeFlows: edges };
  }

  return { windows: stats };
}
