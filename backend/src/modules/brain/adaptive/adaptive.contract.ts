/**
 * P12 — Adaptive Coefficient Learning Contract
 * 
 * Adaptive tuning of deterministic rule parameters through walk-forward.
 * NOT ML blackbox — just rolling recalibration of weights.
 * 
 * Three groups:
 * 1. Brain Quantile thresholds
 * 2. Optimizer coefficients
 * 3. MetaRisk mapping coefficients
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type AdaptiveScope = 'brain_rules' | 'optimizer' | 'metarisk';
export type AdaptiveMode = 'off' | 'shadow' | 'on';
export type AssetId = 'dxy' | 'spx' | 'btc';

// ═══════════════════════════════════════════════════════════════
// PARAMETER GROUPS
// ═══════════════════════════════════════════════════════════════

export interface BrainRulesParams {
  tailQ05: number;          // e.g. -0.035 (threshold for TAIL scenario)
  spread: number;           // e.g. 0.12 (threshold for uncertainty)
  bullMean: number;         // e.g. 0.01 (threshold for bull extension)
}

export interface OptimizerParams {
  K: number;                // Score → delta conversion (0.30)
  wReturn: number;          // Expected return weight (1.00)
  wTail: number;            // Tail risk penalty weight (1.20)
  wCorr: number;            // Correlation penalty weight (0.80)
  wGuard: number;           // Defensive posture penalty (0.60)
  capBase: number;          // Max delta base (0.15)
  capDefensive: number;     // Max delta defensive (0.08)
  capTail: number;          // Max delta TAIL (0.10)
}

export interface MetaRiskParams {
  durationScale: number;    // Duration boost multiplier (1.0)
  stabilityScale: number;   // Stability boost multiplier (1.0)
  flipPenalty: number;      // Flip penalty multiplier (1.0)
  crossAdj: number;         // Cross-asset adjustment multiplier (1.0)
}

export interface AdaptiveGates {
  minDeltaHitRatePp: number;       // Minimum improvement in pp (default 2)
  maxDegradationPp: number;        // Max allowed degradation (default -1)
  maxFlipRatePerYear: number;      // Max flip rate (default 6)
  maxOverrideIntensityBase: number; // Max intensity BASE/RISK (0.35)
  maxOverrideIntensityTail: number; // Max intensity TAIL (0.60)
}

// ═══════════════════════════════════════════════════════════════
// MAIN PARAMS PACK
// ═══════════════════════════════════════════════════════════════

export interface AdaptiveParams {
  versionId: string;          // e.g. adaptive_dxy_2026-02-28T...
  asset: AssetId;
  
  brain: BrainRulesParams;
  optimizer: OptimizerParams;
  metarisk: MetaRiskParams;
  gates: AdaptiveGates;
  
  updatedAt: string;
  source: 'default' | 'tuned' | 'promoted';
}

// ═══════════════════════════════════════════════════════════════
// TUNING RUN CONTRACT
// ═══════════════════════════════════════════════════════════════

export interface TuningRunRequest {
  asset: AssetId;
  start: string;
  end: string;
  steps: number;
  mode: AdaptiveMode;
  gridSize?: number;         // Default 3 (0.9x, 1.0x, 1.1x)
}

export interface TuningCandidate {
  params: AdaptiveParams;
  score: number;
  metrics: TuningMetrics;
}

export interface TuningMetrics {
  avgDeltaHitRatePp: number;
  minDeltaPp: number;
  maxDeltaPp: number;
  flipRatePerYear: number;
  avgOverrideIntensity: number;
  maxOverrideIntensity: number;
  stabilityScore: number;        // 0..1 (variance of deltas between steps)
  degradationCount: number;      // How many horizons degraded
  
  // P12 Extended metrics
  tailScenarioRate: number;      // % of steps where scenario=TAIL
  intensityVariance: number;     // Variance of override intensity
  regimeFlipSensitivity: number; // How often regime changes affect delta
  
  // Horizon breakdown
  deltaByHorizon: {
    d30: number;                 // Hit rate for 30D
    d90: number;                 // Hit rate for 90D
    d180: number;                // Hit rate for 180D
    d365: number;                // Hit rate for 365D
  };
  
  // Regime breakdown
  flipRateByRegime: {
    base: number;
    risk: number;
    tail: number;
  };
}

export interface TuningRunReport {
  runId: string;
  asset: AssetId;
  start: string;
  end: string;
  steps: number;
  mode: AdaptiveMode;
  
  status: 'running' | 'complete' | 'failed';
  startedAt: string;
  completedAt?: string;
  
  baseline: TuningCandidate;     // Current params metrics
  best: TuningCandidate;         // Best found params
  candidatesEvaluated: number;
  
  gates: {
    passed: boolean;
    checks: {
      deltaHitRate: boolean;
      degradation: boolean;
      flipRate: boolean;
      overrideIntensity: boolean;
      determinism: boolean;
      noLookahead: boolean;
    };
    reasons: string[];
  };
  
  recommendation: 'promote' | 'reject' | 'review';
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT PARAMETERS
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_BRAIN_PARAMS: BrainRulesParams = {
  tailQ05: -0.035,
  spread: 0.12,
  bullMean: 0.01,
};

export const DEFAULT_OPTIMIZER_PARAMS: OptimizerParams = {
  K: 0.30,
  wReturn: 1.00,
  wTail: 1.20,
  wCorr: 0.80,
  wGuard: 0.60,
  capBase: 0.15,
  capDefensive: 0.08,
  capTail: 0.10,
};

export const DEFAULT_METARISK_PARAMS: MetaRiskParams = {
  durationScale: 1.0,
  stabilityScale: 1.0,
  flipPenalty: 1.0,
  crossAdj: 1.0,
};

export const DEFAULT_GATES: AdaptiveGates = {
  minDeltaHitRatePp: 2,
  maxDegradationPp: -1,
  maxFlipRatePerYear: 6,
  maxOverrideIntensityBase: 0.35,
  maxOverrideIntensityTail: 0.60,
};

export function createDefaultParams(asset: AssetId): AdaptiveParams {
  return {
    versionId: `default_${asset}_v1`,
    asset,
    brain: { ...DEFAULT_BRAIN_PARAMS },
    optimizer: { ...DEFAULT_OPTIMIZER_PARAMS },
    metarisk: { ...DEFAULT_METARISK_PARAMS },
    gates: { ...DEFAULT_GATES },
    updatedAt: new Date().toISOString(),
    source: 'default',
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Smooth update: new = alpha * candidate + (1-alpha) * current
 */
export function smoothUpdate(current: number, candidate: number, alpha: number = 0.35): number {
  return round4(alpha * candidate + (1 - alpha) * current);
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateAdaptiveParams(params: AdaptiveParams): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Brain params bounds
  if (params.brain.tailQ05 > 0) errors.push('tailQ05 should be negative');
  if (params.brain.spread < 0) errors.push('spread should be positive');
  
  // Optimizer params bounds
  if (params.optimizer.K < 0.1 || params.optimizer.K > 0.5) errors.push('K out of bounds [0.1, 0.5]');
  if (params.optimizer.capBase > 0.20) errors.push('capBase exceeds hard max 0.20');
  if (params.optimizer.capDefensive > 0.12) errors.push('capDefensive exceeds hard max 0.12');
  if (params.optimizer.capTail > 0.15) errors.push('capTail exceeds hard max 0.15');
  
  // MetaRisk params bounds
  if (params.metarisk.durationScale < 0.5 || params.metarisk.durationScale > 1.5) {
    errors.push('durationScale out of bounds [0.5, 1.5]');
  }
  
  return { valid: errors.length === 0, errors };
}
