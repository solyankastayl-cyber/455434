/**
 * Phase R9: Reliability Types
 */

export type ReliabilityKey = {
  patternType: string;
  timeframe: string;
  regime: string;
  volRegime?: string;
};

export type ReliabilityStats = ReliabilityKey & {
  n: number;
  wins: number;
  losses: number;
  timeouts: number;
  noEntry: number;
  
  avgMFE: number;
  avgMAE: number;
  avgRR: number;
  
  winRate: number;
  pWinSmoothed: number;
  ece?: number;
  updatedAt: number;
};

export type PatternCluster = {
  id: string;
  patterns: any[];
  representative: any;
  confidence: number;
};

export type EffectiveScoreParams = {
  baseScore: number;
  pWin: number;
  ageDays: number;
  timeframe: string;
  regime: string;
  rr: number;
};

export type ReliabilityConfig = {
  smoothingStrength: number;
  prior: number;
  decayHalfLifeDays: number;
  minSamplesForStats: number;
  clusterOverlapThreshold: number;
  clusterPriceTolerance: number;
};

export const DEFAULT_RELIABILITY_CONFIG: ReliabilityConfig = {
  smoothingStrength: 30,
  prior: 0.5,
  decayHalfLifeDays: 14,
  minSamplesForStats: 5,
  clusterOverlapThreshold: 0.6,
  clusterPriceTolerance: 0.003,
};
