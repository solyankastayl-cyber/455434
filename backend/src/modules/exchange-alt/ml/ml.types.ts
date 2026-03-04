/**
 * BLOCK 6 — ML Types & Contracts
 * ===============================
 * 
 * ML layer on top of pattern clusters.
 * Answers: "Which patterns historically give positive outcomes?"
 */

// ═══════════════════════════════════════════════════════════════
// CLUSTER LEARNING SAMPLE
// ═══════════════════════════════════════════════════════════════

export interface ClusterLearningSample {
  _id?: any;
  
  venue: 'BINANCE' | 'BYBIT' | 'MOCK';
  tf: '1h' | '4h' | '1d';
  ts: number;
  
  clusterId: string;
  patternLabel: string;
  
  // FEATURES (cluster aggregates)
  features: ClusterFeatures;
  
  // META
  marketContext: MarketContext;
  
  // LABEL
  outcomeReturn: number;     // avgReturn over horizon
  outcomeClass: 'UP' | 'FLAT' | 'DOWN';
  horizon: '1h' | '4h' | '24h';
  
  // Quality
  memberCount: number;
  createdAt: number;
}

export interface ClusterFeatures {
  avgRSI: number;
  avgRSIZ: number;
  avgFunding: number;
  avgFundingZ: number;
  avgOIChange: number;
  avgOIZ: number;
  avgVolumeSpike: number;
  avgVolatilityZ: number;
  liquidationBias: number;
  trendAlignment: number;
  volatilityRegime: number;
  squeezeScore: number;
  breakoutScore: number;
  meanrevScore: number;
  longBias: number;
}

export interface MarketContext {
  marketRegime: 'BULL' | 'BEAR' | 'RANGE' | 'RISK_OFF';
  btcTrend: number;        // -1 to +1
  btcVolatility: number;   // 0 to 1
  fundingGlobal: number;
  fearGreed?: number;      // 0-100 if available
}

// ═══════════════════════════════════════════════════════════════
// PATTERN STATS
// ═══════════════════════════════════════════════════════════════

export interface PatternStats {
  patternId: string;
  patternLabel: string;
  
  // Counts
  totalSamples: number;
  upCount: number;
  flatCount: number;
  downCount: number;
  
  // Rates
  hitRate: number;         // UP / (UP + DOWN)
  successRate: number;     // UP / total
  avgReturn: number;
  medianReturn: number;
  
  // Consistency
  streakTP: number;        // consecutive TPs
  streakFP: number;        // consecutive FPs
  consistency: number;     // TP_streak / total
  
  // Regime breakdown
  byRegime: Record<string, {
    samples: number;
    hitRate: number;
    avgReturn: number;
  }>;
  
  lastUpdated: number;
}

// ═══════════════════════════════════════════════════════════════
// PATTERN WEIGHT
// ═══════════════════════════════════════════════════════════════

export interface PatternWeight {
  patternId: string;
  patternLabel: string;
  
  weight: number;          // 0.5 .. 2.0
  confidence: number;      // 0..1
  
  // Context-specific weights
  byRegime: Record<string, number>;
  
  // Meta
  sampleCount: number;
  frozen: boolean;
  freezeReason?: string;
  lastUpdated: number;
}

// ═══════════════════════════════════════════════════════════════
// ML MODEL TYPES
// ═══════════════════════════════════════════════════════════════

export interface ClusterPrediction {
  probUP: number;
  probFLAT: number;
  probDOWN: number;
  confidence: number;
  patternConfidence: number;
}

export interface ModelHealth {
  status: 'HEALTHY' | 'DEGRADED' | 'FROZEN';
  accuracy7d: number;
  agreementRate: number;
  sampleCount: number;
  lastTrainedAt: number;
  driftDetected: boolean;
}

// ═══════════════════════════════════════════════════════════════
// LABELING THRESHOLDS
// ═══════════════════════════════════════════════════════════════

export const OUTCOME_THRESHOLDS = {
  UP: 3,      // > 3% = UP
  DOWN: -3,   // < -3% = DOWN
  // else FLAT
} as const;

export const ML_GUARDS = {
  minSamplesPerCluster: 20,
  minSamplesForTraining: 300,
  minAgreementRate: 0.6,
  maxAccuracyDrop: 0.15,
  rollingWindowDays: 60,
} as const;

export function labelOutcome(avgReturn: number): 'UP' | 'FLAT' | 'DOWN' {
  if (avgReturn > OUTCOME_THRESHOLDS.UP) return 'UP';
  if (avgReturn < OUTCOME_THRESHOLDS.DOWN) return 'DOWN';
  return 'FLAT';
}

console.log('[Block6] ML Types loaded');
