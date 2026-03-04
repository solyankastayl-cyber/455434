/**
 * Phase K: ML Dataset Types
 * 
 * Feature-rich dataset schema for ML model training
 */

export type MarketRegimeType = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'TRANSITION';
export type VolRegimeType = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

/**
 * ML Dataset Row - one row per scenario with outcome
 */
export interface MLRow {
  // Identifiers
  runId: string;
  scenarioId: string;
  asset: string;
  timeframe: string;
  createdAt: number;

  // Target variable (what we're predicting)
  outcome: 0 | 1;  // 0 = LOSS, 1 = WIN

  // Baseline prediction from rules engine
  score: number;
  calibratedProbability: number;

  // Regime context
  marketRegime: MarketRegimeType;
  volRegime: VolRegimeType;

  // Pattern composition
  patternCount: number;
  primaryPattern: string;

  // Confluence metrics
  confluenceScore: number;
  confluenceFactors: number;

  // Structure features
  trendAlignment: number;  // -1 to 1

  // MA features
  ma20Slope: number;
  ma50Slope: number;
  maAlignment: number;  // -1 = BEAR, 0 = MIXED, 1 = BULL

  // Volatility features
  atrPercentile: number;  // 0 to 1

  // Geometry features
  compression: number;  // 0 to 1

  // Risk pack metrics
  rrToT1: number;
  rrToT2: number;
  riskPct: number;
  rewardPct: number;
}

/**
 * Dataset build options
 */
export interface DatasetBuildOptions {
  asset?: string;
  timeframe?: string;
  limit?: number;
  minScore?: number;
  includeTimeout?: boolean;
}

/**
 * Dataset build result
 */
export interface DatasetBuildResult {
  ok: boolean;
  rows: MLRow[];
  stats: {
    totalRuns: number;
    totalScenarios: number;
    totalOutcomes: number;
    wins: number;
    losses: number;
    timeouts: number;
    skipped: number;
    finalRows: number;
  };
  timestamp: string;
}
