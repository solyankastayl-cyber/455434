/**
 * BLOCK 81 — Drift Intelligence Types
 * 
 * Types for institutional-grade LIVE vs V2014/V2020 drift comparison.
 */

export type DriftIntelSeverity = 'OK' | 'WATCH' | 'WARN' | 'CRITICAL';
export type DriftIntelConfidence = 'LOW' | 'MED' | 'HIGH';
export type CohortId = 'LIVE' | 'V2020' | 'V2014';

export interface DriftIntelMetrics {
  hitRate: number;           // 0..1
  expectancy: number;        // decimal
  sharpe: number;            // ratio
  maxDD: number;             // decimal (e.g., 0.15 = 15%)
  profitFactor: number;      // ratio
  calibrationError: number;  // expected - realized gap
  samples: number;           // outcome count
}

export interface DriftIntelDelta {
  dHitRate_pp: number;       // percentage points
  dSharpe: number;           // absolute
  dCalibration_pp: number;   // percentage points
  dMaxDD_pp: number;         // percentage points
  dExpectancy: number;       // absolute
  dProfitFactor: number;     // absolute
}

export interface DriftIntelVerdict {
  severity: DriftIntelSeverity;
  confidence: DriftIntelConfidence;
  insufficientLiveTruth: boolean;
  reasons: string[];
  recommendedActions: string[];
}

export interface CohortMetricsBlock {
  cohortId: CohortId;
  metrics: DriftIntelMetrics;
  coverage: {
    horizons: string[];          // ['7d', '14d', '30d', ...]
    presets: string[];           // ['conservative', 'balanced', ...]
    regimes: string[];           // ['LOW', 'NORMAL', 'HIGH', 'CRISIS']
    dateRange: {
      from: string;
      to: string;
    };
  };
}

export interface TierBreakdown {
  tier: string;
  live: DriftIntelMetrics;
  v2020: DriftIntelMetrics;
  v2014: DriftIntelMetrics;
  delta_LIVE_V2020: DriftIntelDelta | null;
  delta_LIVE_V2014: DriftIntelDelta | null;
  worstSeverity: DriftIntelSeverity;
}

export interface RegimeBreakdown {
  regime: string;
  live: DriftIntelMetrics;
  v2020: DriftIntelMetrics;
  v2014: DriftIntelMetrics;
  delta_LIVE_V2020: DriftIntelDelta | null;
  delta_LIVE_V2014: DriftIntelDelta | null;
  worstSeverity: DriftIntelSeverity;
}

export interface DivergenceBreakdown {
  grade: string;             // A, B, C, D, F
  live: DriftIntelMetrics;
  v2020: DriftIntelMetrics;
  v2014: DriftIntelMetrics;
  delta_LIVE_V2020: DriftIntelDelta | null;
  delta_LIVE_V2014: DriftIntelDelta | null;
  worstSeverity: DriftIntelSeverity;
}

export interface DriftIntelligenceResponse {
  symbol: string;
  windowDays: number;
  asOf: string;

  // Cohort snapshots
  live: CohortMetricsBlock;
  baselines: {
    V2020: CohortMetricsBlock;
    V2014: CohortMetricsBlock;
  };

  // Delta comparisons
  deltas: {
    LIVE_vs_V2020: DriftIntelDelta | null;
    LIVE_vs_V2014: DriftIntelDelta | null;
    V2020_vs_V2014: DriftIntelDelta | null;
  };

  // Overall verdict
  verdict: DriftIntelVerdict;

  // Breakdowns
  breakdowns: {
    byTier: TierBreakdown[];
    byRegime: RegimeBreakdown[];
    byDivergence: DivergenceBreakdown[];
  };

  // Severity thresholds for UI reference
  thresholds: {
    WATCH: { hitRate_pp: number; sharpe: number; calibration_pp: number };
    WARN: { hitRate_pp: number; sharpe: number; calibration_pp: number };
    CRITICAL: { hitRate_pp: number; sharpe: number; calibration_pp: number };
  };

  meta: {
    computedAt: string;
    engineVersion: string;
  };
}

export interface DriftIntelHistoryRecord {
  date: string;
  symbol: string;
  source: 'LIVE';
  
  severity: DriftIntelSeverity;
  confidence: DriftIntelConfidence;
  insufficientLiveTruth: boolean;
  
  liveSamples: number;
  
  dHitRate_pp: number;
  dSharpe: number;
  dCalibration_pp: number;
  dMaxDD_pp: number;
  
  baseline: 'V2020';
  
  engineVersion: string;
  policyHash: string;
}
