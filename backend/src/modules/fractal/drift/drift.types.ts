/**
 * BLOCK 78.1 — Drift Intelligence Types
 * 
 * Type definitions for cohort comparison drift analysis.
 * Compares LIVE vs V2020, LIVE vs V2014, V2014 vs V2020.
 */

export type DriftSeverity = 'OK' | 'WATCH' | 'WARN' | 'CRITICAL';

export type DriftPair = 'LIVE_V2020' | 'LIVE_V2014' | 'V2014_V2020';

export interface DriftScope {
  symbol: string;
  focus: string;          // 7d/14d/30d/90d/180d/365d
  preset: string;         // conservative/balanced/aggressive
  role: 'ACTIVE' | 'SHADOW';
  windowDays: number;     // default 365
}

export interface DriftDeltas {
  hitRatePP: number;      // percentage points (+3.2 = +3.2pp)
  expectancy: number;     // absolute decimal
  sharpe: number;         // absolute
  calibrationPP: number;  // expected-realized gap delta in pp
  maxDDPP?: number;       // optional
}

export interface DriftSample {
  a: number;              // cohort A sample size
  b: number;              // cohort B sample size
  minRequiredLive: number;
}

export interface DriftComparison {
  pair: DriftPair;
  cohortA: string;
  cohortB: string;
  sample: DriftSample;
  deltas: DriftDeltas;
  severity: DriftSeverity;
  reasons: DriftReason[];
}

export type DriftReason = 
  | 'CALIBRATION_DRIFT'
  | 'REGIME_MISMATCH'
  | 'PHASE_DECAY'
  | 'TAIL_SHIFT'
  | 'DIVERGENCE_INFLATION'
  | 'LOW_SAMPLE'
  | 'HIT_RATE_DRIFT'
  | 'SHARPE_COLLAPSE';

export interface DriftBreakdownEntry {
  key: string;
  comparisons: DriftComparison[];
  worstSeverity: DriftSeverity;
}

export interface DriftBreakdown {
  tier: Record<string, DriftBreakdownEntry>;
  regime: Record<string, DriftBreakdownEntry>;
  phase: Record<string, DriftBreakdownEntry>;
  divergenceGrade: Record<string, DriftBreakdownEntry>;
}

export type DriftRecommendation = 'NO_ACTION' | 'TUNE_ALLOWED' | 'LOCKDOWN' | 'INVESTIGATE';

export interface DriftVerdict {
  overallSeverity: DriftSeverity;
  recommendation: DriftRecommendation;
  notes: string[];
  blockedActions: string[];
}

export interface DriftPayload {
  symbol: 'BTC';
  asof: string;
  scope: DriftScope;
  comparisons: DriftComparison[];
  breakdown: DriftBreakdown;
  verdict: DriftVerdict;
  meta: {
    totalLiveSamples: number;
    totalV2020Samples: number;
    totalV2014Samples: number;
    computedAt: string;
  };
}
