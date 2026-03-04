/**
 * Actor Score Service
 * 
 * EPIC A2: Actor Scores calculation and management
 * 
 * Orchestrates:
 * - Score calculation for all actors
 * - Score retrieval with filtering
 * - Integration with Actor model
 */

import { v4 as uuidv4 } from 'uuid';
import type { 
  ActorScore, 
  ActorMetrics, 
  ScoreWindow, 
  ScoreCalculateConfig,
  ScoreCalculateStats,
  FlowRole
} from './actor_score.types.js';
import { SCORE_WINDOWS } from './actor_score.types.js';
import { 
  calculateActorScore, 
  buildMetrics 
} from './actor_score.calculator.js';
import {
  saveActorScoresBatch,
  getActorScore,
  getActorScores,
  getTopActorsByEdgeScore,
  getScoreStats,
  createScoreRun,
  completeScoreRun,
  failScoreRun,
  getRecentScoreRuns,
  ActorScoreModel,
  saveScoreSnapshot
} from './actor_score.model.js';
import { ActorModel, IActorDocument } from '../actors/actor.model.js';

// ============================================
// RAW DATA AGGREGATION
// ============================================

interface ActorRawData {
  actorId: string;
  sourceLevel: string;
  totalVolumeUsd: number;
  inflowUsd: number;
  outflowUsd: number;
  txCount: number;
  uniqueTokens: number;
  uniqueCounterparties: number;
}

/**
 * Get raw data for actors from transfers/transactions
 * This is a placeholder - in production connects to actual data sources
 */
async function getActorRawData(
  actorIds: string[],
  window: ScoreWindow
): Promise<ActorRawData[]> {
  // Get actors
  const actors = await ActorModel.find(
    actorIds.length > 0 ? { id: { $in: actorIds } } : {}
  ).lean();
  
  // Calculate time range (for production query filtering)
  const windowMs = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }[window];
  
  // Note: In production, `since` will filter transactions by createdAt
  // const since = new Date(Date.now() - windowMs);
  void windowMs; // Mark as intentionally unused for now
  
  // For now, generate simulated data based on actor attributes
  // In production, this queries transfer collections
  return actors.map(actor => {
    // Base activity score from coverage
    const activityMultiplier = (actor.coverage?.score || 50) / 100;
    
    // Simulate data based on actor type
    const typeMultiplier = {
      'exchange': 10,
      'market_maker': 8,
      'fund': 5,
      'whale': 3,
      'trader': 1,
    }[actor.type] || 1;
    
    const baseVolume = 100000 * typeMultiplier * activityMultiplier;
    const baseTxCount = 50 * typeMultiplier * activityMultiplier;
    
    // Add some randomness
    const variance = () => 0.5 + Math.random();
    
    const inflowUsd = baseVolume * variance();
    const outflowUsd = baseVolume * variance() * 0.8;
    
    return {
      actorId: actor.id,
      sourceLevel: actor.sourceLevel,
      totalVolumeUsd: inflowUsd + outflowUsd,
      inflowUsd,
      outflowUsd,
      txCount: Math.round(baseTxCount * variance()),
      uniqueTokens: Math.round(5 + 15 * activityMultiplier * variance()),
      uniqueCounterparties: Math.round(10 + 40 * activityMultiplier * variance()),
    };
  });
}

/**
 * Get total network tx count for participation calculation
 */
async function getNetworkTotalTxCount(_window: ScoreWindow): Promise<number> {
  // Placeholder: Return estimated network total
  // In production, this aggregates from actual transaction data
  return 10000;
}

// ============================================
// SCORE CALCULATION SERVICE
// ============================================

/**
 * Calculate scores for actors
 */
export async function runScoreCalculation(
  config: ScoreCalculateConfig
): Promise<ScoreCalculateStats> {
  const runId = uuidv4();
  const { window, actorIds = [] } = config;
  // Note: forceRecalc can be used to bypass caching in future
  
  console.log(`[ActorScores] Starting calculation run ${runId} for window ${window}`);
  
  try {
    await createScoreRun(runId, window);
    
    // Get raw data
    const rawData = await getActorRawData(actorIds, window);
    const networkTxCount = await getNetworkTotalTxCount(window);
    
    console.log(`[ActorScores] Processing ${rawData.length} actors...`);
    
    // Calculate scores
    const scores: ActorScore[] = [];
    const flowRoleCounts: Record<FlowRole, number> = {
      'accumulator': 0,
      'distributor': 0,
      'neutral': 0,
      'market_maker_like': 0,
    };
    let totalEdgeScore = 0;
    
    for (const data of rawData) {
      // Build metrics
      const metrics: ActorMetrics = buildMetrics({
        totalVolumeUsd: data.totalVolumeUsd,
        inflowUsd: data.inflowUsd,
        outflowUsd: data.outflowUsd,
        txCount: data.txCount,
        uniqueTokens: data.uniqueTokens,
        uniqueCounterparties: data.uniqueCounterparties,
      });
      
      // Calculate score
      const score = calculateActorScore(
        data.actorId,
        window,
        metrics,
        data.sourceLevel,
        networkTxCount
      );
      
      scores.push(score);
      flowRoleCounts[score.flowRole]++;
      totalEdgeScore += score.edgeScore;
    }
    
    // Save scores
    const saved = await saveActorScoresBatch(scores);
    console.log(`[ActorScores] Saved ${saved} scores`);
    
    // Save daily snapshots for history
    for (const score of scores) {
      await saveScoreSnapshot(
        score.actorId,
        score.window,
        score.edgeScore,
        score.participation,
        score.flowRole
      );
    }
    
    // Calculate average
    const avgEdgeScore = scores.length > 0 
      ? Math.round(totalEdgeScore / scores.length) 
      : 0;
    
    // Complete run
    const stats: ScoreCalculateStats = {
      runId,
      window,
      startedAt: new Date(),
      completedAt: new Date(),
      status: 'COMPLETED',
      actorsProcessed: rawData.length,
      scoresCalculated: saved,
      byFlowRole: flowRoleCounts,
      avgEdgeScore,
      errors: [],
    };
    
    await completeScoreRun(runId, stats);
    
    console.log(`[ActorScores] Calculation complete. Avg edge score: ${avgEdgeScore}`);
    return stats;
    
  } catch (error) {
    console.error(`[ActorScores] Calculation failed:`, error);
    await failScoreRun(runId, error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

/**
 * Recalculate all windows
 */
export async function recalculateAllScores(): Promise<ScoreCalculateStats[]> {
  const results: ScoreCalculateStats[] = [];
  
  for (const window of SCORE_WINDOWS) {
    const stats = await runScoreCalculation({ window });
    results.push(stats);
  }
  
  return results;
}

// ============================================
// QUERY SERVICE
// ============================================

export interface ActorScoreListItem {
  actorId: string;
  actorName?: string;
  actorType?: string;
  sourceLevel?: string;
  edgeScore: number;
  participation: number;
  flowRole: FlowRole;
  coverage: {
    score: number;
    band: string;
  };
  activityRegime?: {
    regime: 'INCREASING' | 'STABLE' | 'DECREASING' | 'UNKNOWN';
    participationTrend: string;
  };
  metrics: {
    totalVolumeUsd: number;
    txCount: number;
  };
}

export interface ActorScoreQueryOptions {
  window: ScoreWindow;
  flowRole?: FlowRole;
  minEdgeScore?: number;
  maxEdgeScore?: number;
  sort?: 'edge_score' | 'participation' | 'volume';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/**
 * Query actor scores with filters
 */
export async function queryActorScores(
  options: ActorScoreQueryOptions
): Promise<{
  scores: ActorScoreListItem[];
  total: number;
  page: number;
  limit: number;
}> {
  const {
    window,
    flowRole,
    minEdgeScore,
    maxEdgeScore,
    sort = 'edge_score',
    sortOrder = 'desc',
    page = 1,
    limit = 20,
  } = options;
  
  // Build query
  const query: Record<string, unknown> = { window };
  
  if (flowRole) query.flowRole = flowRole;
  if (minEdgeScore !== undefined || maxEdgeScore !== undefined) {
    query.edgeScore = {};
    if (minEdgeScore !== undefined) (query.edgeScore as Record<string, number>).$gte = minEdgeScore;
    if (maxEdgeScore !== undefined) (query.edgeScore as Record<string, number>).$lte = maxEdgeScore;
  }
  
  // Sort mapping
  const sortField = {
    edge_score: 'edgeScore',
    participation: 'participation',
    volume: 'metrics.totalVolumeUsd',
  }[sort] || 'edgeScore';
  
  const sortDir = sortOrder === 'asc' ? 1 : -1;
  
  // Execute query
  const skip = (page - 1) * limit;
  
  const [scoresDocs, total] = await Promise.all([
    ActorScoreModel.find(query)
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(limit)
      .lean(),
    ActorScoreModel.countDocuments(query),
  ]);
  
  // Get actor details
  const actorIds = scoresDocs.map(s => s.actorId);
  const actors = await ActorModel.find({ id: { $in: actorIds } }).lean();
  const actorMap = new Map(actors.map(a => [a.id, a]));
  
  // Map to list items
  const scores: ActorScoreListItem[] = scoresDocs.map(s => {
    const actor = actorMap.get(s.actorId);
    
    // Calculate activity regime based on participation trend
    // In production, this uses EPIC 7 temporal data
    const participation = s.participation || 0;
    let regime: 'INCREASING' | 'STABLE' | 'DECREASING' | 'UNKNOWN' = 'UNKNOWN';
    let participationTrend = 'stable';
    
    // Simulated regime based on flow role and metrics
    if (s.flowRole === 'accumulator') {
      regime = 'INCREASING';
      participationTrend = 'increasing over last 7d';
    } else if (s.flowRole === 'distributor') {
      regime = 'DECREASING';
      participationTrend = 'decreasing over last 7d';
    } else if (participation > 0.01) {
      regime = 'STABLE';
      participationTrend = 'stable over last 7d';
    }
    
    return {
      actorId: s.actorId,
      actorName: actor?.name,
      actorType: actor?.type,
      sourceLevel: actor?.sourceLevel || 'behavioral',
      edgeScore: s.edgeScore,
      participation: s.participation,
      flowRole: s.flowRole as FlowRole,
      coverage: {
        score: actor?.coverage?.score || 0,
        band: actor?.coverage?.band || 'Low',
      },
      activityRegime: {
        regime,
        participationTrend,
      },
      metrics: {
        totalVolumeUsd: s.metrics.totalVolumeUsd,
        txCount: s.metrics.txCount,
      },
    };
  });
  
  return {
    scores,
    total,
    page,
    limit,
  };
}

/**
 * Get score for specific actor
 */
export async function getActorScoreDetail(
  actorId: string,
  window?: ScoreWindow
): Promise<{
  actor: IActorDocument | null;
  scores: ActorScore[];
}> {
  const actor = await ActorModel.findOne({ id: actorId }).lean();
  
  let scores;
  if (window) {
    const score = await getActorScore(actorId, window);
    scores = score ? [score] : [];
  } else {
    scores = await getActorScores(actorId);
  }
  
  return { actor, scores: scores as ActorScore[] };
}

/**
 * Get leaderboard
 */
export async function getScoreLeaderboard(
  window: ScoreWindow,
  limit: number = 20
): Promise<ActorScoreListItem[]> {
  const scoresDocs = await getTopActorsByEdgeScore(window, limit);
  
  // Get actor details
  const actorIds = scoresDocs.map(s => s.actorId);
  const actors = await ActorModel.find({ id: { $in: actorIds } }).lean();
  const actorMap = new Map(actors.map(a => [a.id, a]));
  
  return scoresDocs.map(s => {
    const actor = actorMap.get(s.actorId);
    
    // Calculate activity regime
    const participation = s.participation || 0;
    let regime: 'INCREASING' | 'STABLE' | 'DECREASING' | 'UNKNOWN' = 'UNKNOWN';
    let participationTrend = 'stable';
    
    if (s.flowRole === 'accumulator') {
      regime = 'INCREASING';
      participationTrend = 'increasing over last 7d';
    } else if (s.flowRole === 'distributor') {
      regime = 'DECREASING';
      participationTrend = 'decreasing over last 7d';
    } else if (participation > 0.01) {
      regime = 'STABLE';
      participationTrend = 'stable over last 7d';
    }
    
    return {
      actorId: s.actorId,
      actorName: actor?.name,
      actorType: actor?.type,
      sourceLevel: actor?.sourceLevel || 'behavioral',
      edgeScore: s.edgeScore,
      participation: s.participation,
      flowRole: s.flowRole as FlowRole,
      coverage: {
        score: actor?.coverage?.score || 0,
        band: actor?.coverage?.band || 'Low',
      },
      activityRegime: {
        regime,
        participationTrend,
      },
      metrics: {
        totalVolumeUsd: s.metrics.totalVolumeUsd,
        txCount: s.metrics.txCount,
      },
    };
  });
}

/**
 * Get score summary stats
 */
export async function getScoreSummary(window: ScoreWindow): Promise<{
  total: number;
  avgEdgeScore: number;
  byFlowRole: Record<string, number>;
  distribution: {
    elite: number;
    high: number;
    medium: number;
    low: number;
  };
}> {
  const stats = await getScoreStats(window);
  
  // Get distribution
  const [elite, high, medium, low] = await Promise.all([
    ActorScoreModel.countDocuments({ window, edgeScore: { $gte: 80 } }),
    ActorScoreModel.countDocuments({ window, edgeScore: { $gte: 60, $lt: 80 } }),
    ActorScoreModel.countDocuments({ window, edgeScore: { $gte: 40, $lt: 60 } }),
    ActorScoreModel.countDocuments({ window, edgeScore: { $lt: 40 } }),
  ]);
  
  return {
    ...stats,
    distribution: { elite, high, medium, low },
  };
}

// ============================================
// RUN HISTORY
// ============================================

/**
 * Get calculation run history
 */
export async function getScoreRunHistory(limit: number = 10) {
  return getRecentScoreRuns(limit);
}
