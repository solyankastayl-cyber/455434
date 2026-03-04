/**
 * Actor Score Calculator
 * 
 * EPIC A2: Pure calculation logic for actor scores
 * 
 * Edge Score formula:
 *   EdgeScore = 0.4 × log(volume) + 0.3 × diversity + 0.3 × counterparties
 *   Adjusted by source level penalty
 */

import type { 
  ActorScore, 
  ActorMetrics, 
  FlowRole, 
  ScoreWindow 
} from './actor_score.types.js';
import { SCORE_THRESHOLDS } from './actor_score.types.js';

// ============================================
// FLOW ROLE CLASSIFICATION
// ============================================

/**
 * Classify actor's flow role based on metrics
 */
export function classifyFlowRole(metrics: ActorMetrics): FlowRole {
  const { netFlowUsd, totalVolumeUsd, bidirectionalRatio, txCount } = metrics;
  const t = SCORE_THRESHOLDS.flowRole;
  
  // Calculate net flow ratio
  const netFlowRatio = totalVolumeUsd > 0 ? netFlowUsd / totalVolumeUsd : 0;
  
  // Market maker like: bidirectional + high frequency
  if (bidirectionalRatio >= t.mmBidirectionalMin && txCount >= t.mmTxCountMin) {
    return 'market_maker_like';
  }
  
  // Accumulator: significant net inflow
  if (netFlowRatio > t.accumulatorNetFlowRatio) {
    return 'accumulator';
  }
  
  // Distributor: significant net outflow
  if (netFlowRatio < t.distributorNetFlowRatio) {
    return 'distributor';
  }
  
  // Neutral: balanced
  return 'neutral';
}

// ============================================
// EDGE SCORE COMPONENTS
// ============================================

/**
 * Calculate volume component (0-100)
 * Uses log scale to handle large range
 */
export function calculateVolumeComponent(totalVolumeUsd: number): number {
  if (totalVolumeUsd <= 0) return 0;
  
  const logVolume = Math.log10(totalVolumeUsd + 1);
  const maxLog = SCORE_THRESHOLDS.normalization.maxVolumeLog;
  
  // Normalize to 0-100
  const normalized = (logVolume / maxLog) * 100;
  return Math.min(100, Math.max(0, normalized));
}

/**
 * Calculate token diversity component (0-100)
 */
export function calculateDiversityComponent(tokenDiversity: number): number {
  const maxDiv = SCORE_THRESHOLDS.normalization.maxDiversity;
  const normalized = (tokenDiversity / maxDiv) * 100;
  return Math.min(100, Math.max(0, normalized));
}

/**
 * Calculate counterparty component (0-100)
 */
export function calculateCounterpartyComponent(counterparties: number): number {
  const maxCp = SCORE_THRESHOLDS.normalization.maxCounterparties;
  const normalized = (counterparties / maxCp) * 100;
  return Math.min(100, Math.max(0, normalized));
}

/**
 * Get source level adjustment factor
 */
export function getSourceAdjustment(sourceLevel: string): number {
  const adjustments = SCORE_THRESHOLDS.sourceAdjustment;
  return adjustments[sourceLevel as keyof typeof adjustments] || 0.6;
}

// ============================================
// EDGE SCORE CALCULATION
// ============================================

interface EdgeScoreBreakdown {
  volumeComponent: number;
  diversityComponent: number;
  counterpartyComponent: number;
  sourceAdjustment: number;
  rawScore: number;
  finalScore: number;
}

/**
 * Calculate edge score with breakdown
 */
export function calculateEdgeScore(
  metrics: ActorMetrics,
  sourceLevel: string
): EdgeScoreBreakdown {
  const weights = SCORE_THRESHOLDS.edgeScore;
  
  // Calculate components
  const volumeComponent = calculateVolumeComponent(metrics.totalVolumeUsd);
  const diversityComponent = calculateDiversityComponent(metrics.tokenDiversity);
  const counterpartyComponent = calculateCounterpartyComponent(metrics.counterparties);
  
  // Weighted sum
  const rawScore = 
    (volumeComponent * weights.volumeWeight) +
    (diversityComponent * weights.diversityWeight) +
    (counterpartyComponent * weights.counterpartyWeight);
  
  // Apply source adjustment
  const sourceAdjustment = getSourceAdjustment(sourceLevel);
  const finalScore = Math.round(rawScore * sourceAdjustment);
  
  return {
    volumeComponent: Math.round(volumeComponent),
    diversityComponent: Math.round(diversityComponent),
    counterpartyComponent: Math.round(counterpartyComponent),
    sourceAdjustment,
    rawScore: Math.round(rawScore),
    finalScore: Math.min(100, Math.max(0, finalScore)),
  };
}

// ============================================
// PARTICIPATION CALCULATION
// ============================================

/**
 * Calculate participation score (0-1)
 * Relative activity compared to network average
 */
export function calculateParticipation(
  actorTxCount: number,
  networkTotalTxCount: number
): number {
  if (networkTotalTxCount <= 0) return 0;
  
  // Simple ratio (could be enhanced with percentile ranking)
  const ratio = actorTxCount / networkTotalTxCount;
  
  // Scale up (since individual actors are small % of network)
  // Use log scale for better distribution
  const scaled = Math.log10(1 + ratio * 10000) / 4; // 0-1 range roughly
  
  return Math.min(1, Math.max(0, scaled));
}

// ============================================
// FULL SCORE CALCULATION
// ============================================

/**
 * Calculate complete actor score
 */
export function calculateActorScore(
  actorId: string,
  window: ScoreWindow,
  metrics: ActorMetrics,
  sourceLevel: string,
  networkTotalTxCount: number
): ActorScore {
  // Calculate edge score
  const edgeBreakdown = calculateEdgeScore(metrics, sourceLevel);
  
  // Calculate participation
  const participation = calculateParticipation(metrics.txCount, networkTotalTxCount);
  
  // Classify flow role
  const flowRole = classifyFlowRole(metrics);
  
  return {
    actorId,
    window,
    edgeScore: edgeBreakdown.finalScore,
    participation,
    flowRole,
    metrics,
    breakdown: {
      volumeComponent: edgeBreakdown.volumeComponent,
      diversityComponent: edgeBreakdown.diversityComponent,
      counterpartyComponent: edgeBreakdown.counterpartyComponent,
      sourceAdjustment: edgeBreakdown.sourceAdjustment,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================
// BATCH CALCULATION HELPERS
// ============================================

/**
 * Calculate bidirectional ratio from in/out flows
 */
export function calculateBidirectionalRatio(inflowUsd: number, outflowUsd: number): number {
  const total = inflowUsd + outflowUsd;
  if (total === 0) return 0;
  
  const minFlow = Math.min(inflowUsd, outflowUsd);
  const maxFlow = Math.max(inflowUsd, outflowUsd);
  
  // How close to 50/50 split
  return minFlow / (maxFlow || 1);
}

/**
 * Build metrics from raw data
 */
export function buildMetrics(data: {
  totalVolumeUsd: number;
  inflowUsd: number;
  outflowUsd: number;
  txCount: number;
  uniqueTokens: number;
  uniqueCounterparties: number;
}): ActorMetrics {
  return {
    totalVolumeUsd: data.totalVolumeUsd,
    netFlowUsd: data.inflowUsd - data.outflowUsd,
    inflowUsd: data.inflowUsd,
    outflowUsd: data.outflowUsd,
    txCount: data.txCount,
    tokenDiversity: data.uniqueTokens,
    counterparties: data.uniqueCounterparties,
    bidirectionalRatio: calculateBidirectionalRatio(data.inflowUsd, data.outflowUsd),
  };
}
