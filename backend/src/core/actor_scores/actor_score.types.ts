/**
 * Actor Score Types
 * 
 * EPIC A2: Actor Scores (Edge / Participation / Flow)
 * 
 * Scores = structural metrics, NOT predictions
 * "How they influence the network" - not "what will happen"
 */

// ============================================
// SCORE WINDOWS
// ============================================

export type ScoreWindow = '24h' | '7d' | '30d';

export const SCORE_WINDOWS: ScoreWindow[] = ['24h', '7d', '30d'];

// ============================================
// FLOW ROLES (categorical)
// ============================================

export type FlowRole = 
  | 'accumulator'       // Net inflow > threshold
  | 'distributor'       // Net outflow > threshold  
  | 'neutral'           // Balanced
  | 'market_maker_like'; // Bidirectional + high frequency

// ============================================
// RAW METRICS
// ============================================

export interface ActorMetrics {
  totalVolumeUsd: number;
  netFlowUsd: number;
  inflowUsd: number;
  outflowUsd: number;
  txCount: number;
  tokenDiversity: number;      // Unique tokens traded
  counterparties: number;      // Unique addresses interacted with
  bidirectionalRatio: number;  // 0-1, how balanced in/out
}

// ============================================
// ACTOR SCORE MODEL
// ============================================

export interface ActorScore {
  actorId: string;
  window: ScoreWindow;
  
  // Main scores
  edgeScore: number;        // 0-100 (position in network)
  participation: number;     // 0-1 (relative activity)
  flowRole: FlowRole;
  
  // Raw metrics
  metrics: ActorMetrics;
  
  // Breakdown (for UI tooltips)
  breakdown: {
    volumeComponent: number;
    diversityComponent: number;
    counterpartyComponent: number;
    sourceAdjustment: number;  // Penalty for non-verified
  };
  
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// SCORE THRESHOLDS
// ============================================

export const SCORE_THRESHOLDS = {
  // Flow role thresholds
  flowRole: {
    accumulatorNetFlowRatio: 0.3,   // > 30% net inflow
    distributorNetFlowRatio: -0.3,  // < -30% net outflow
    mmBidirectionalMin: 0.4,        // At least 40% in both directions
    mmTxCountMin: 20,               // High frequency
  },
  
  // Edge score component weights
  edgeScore: {
    volumeWeight: 0.4,
    diversityWeight: 0.3,
    counterpartyWeight: 0.3,
  },
  
  // Source level adjustments
  sourceAdjustment: {
    verified: 1.0,
    attributed: 0.85,
    behavioral: 0.6,
  },
  
  // Normalization (for 0-100 scale)
  normalization: {
    maxVolumeLog: 10,       // log10(10B USD)
    maxDiversity: 100,      // 100 unique tokens
    maxCounterparties: 500, // 500 unique counterparties
  },
} as const;

// ============================================
// SCORE BANDS (for UI badges)
// ============================================

export type ScoreBand = 'Elite' | 'High' | 'Medium' | 'Low';

export function getScoreBand(edgeScore: number): ScoreBand {
  if (edgeScore >= 80) return 'Elite';
  if (edgeScore >= 60) return 'High';
  if (edgeScore >= 40) return 'Medium';
  return 'Low';
}

// ============================================
// CALCULATE CONFIG
// ============================================

export interface ScoreCalculateConfig {
  window: ScoreWindow;
  actorIds?: string[];       // Specific actors, or all if empty
  includeMetrics?: boolean;  // Include raw metrics in response
  forceRecalc?: boolean;     // Ignore cache
}

// ============================================
// CALCULATE STATS
// ============================================

export interface ScoreCalculateStats {
  runId: string;
  window: ScoreWindow;
  startedAt: Date;
  completedAt?: Date;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  
  actorsProcessed: number;
  scoresCalculated: number;
  
  byFlowRole: Record<FlowRole, number>;
  avgEdgeScore: number;
  
  errors: string[];
}
