/**
 * BLOCK 77.1 — Learning Types
 * 
 * Institutional-grade learning signal types for Adaptive Weight Learning.
 * All data comes from forward truth (BLOCK 75 Memory Layer).
 */

// ═══════════════════════════════════════════════════════════════
// TIER PERFORMANCE
// ═══════════════════════════════════════════════════════════════

export interface TierPerformance {
  hitRate: number;        // 0-1
  sharpe: number;         // -2 to +3 typical
  expectancy: number;     // decimal (0.021 = 2.1%)
  samples: number;        // count
  maxDD: number;          // max drawdown %
  avgReturn: number;      // average return per trade
  winRate: number;        // wins / total
}

export type TierName = 'STRUCTURE' | 'TACTICAL' | 'TIMING';
export type RegimeName = 'LOW' | 'NORMAL' | 'HIGH' | 'EXPANSION' | 'CRISIS';
export type PhaseName = 'MARKUP' | 'MARKDOWN' | 'ACCUMULATION' | 'DISTRIBUTION' | 'RECOVERY' | 'CAPITULATION';
export type DivergenceGrade = 'A' | 'B' | 'C' | 'D' | 'F';

// ═══════════════════════════════════════════════════════════════
// REGIME PERFORMANCE
// ═══════════════════════════════════════════════════════════════

export type RegimePerformance = Record<RegimeName, TierPerformance>;

// ═══════════════════════════════════════════════════════════════
// PHASE PERFORMANCE
// ═══════════════════════════════════════════════════════════════

export interface PhasePerformanceEntry {
  phase: PhaseName;
  grade: DivergenceGrade;
  hitRate: number;
  sharpe: number;
  expectancy: number;
  samples: number;
  avgStrength: number;
}

// ═══════════════════════════════════════════════════════════════
// DIVERGENCE IMPACT
// ═══════════════════════════════════════════════════════════════

export type DivergenceImpact = Record<DivergenceGrade, TierPerformance>;

// ═══════════════════════════════════════════════════════════════
// EQUITY DRIFT
// ═══════════════════════════════════════════════════════════════

export interface EquityDrift {
  deltaSharpe: number;      // forward - backtest
  deltaMaxDD: number;       // forward - backtest
  deltaHitRate: number;     // forward - backtest
  deltaExpectancy: number;  // forward - backtest
}

// ═══════════════════════════════════════════════════════════════
// LEARNING VECTOR (MAIN OUTPUT OF 77.1)
// ═══════════════════════════════════════════════════════════════

export interface LearningVector {
  // Metadata
  symbol: string;
  windowDays: number;
  asof: string;
  resolvedSamples: number;
  
  // BLOCK 77.4: Source breakdown
  sourceCounts: {
    live: number;
    bootstrap: number;
    total: number;
  };
  
  // Performance by tier
  tier: Record<TierName, TierPerformance>;
  
  // Performance by regime
  regime: RegimePerformance;
  
  // Performance by phase
  phase: PhasePerformanceEntry[];
  
  // Divergence impact
  divergenceImpact: DivergenceImpact;
  
  // Equity drift (forward vs backtest)
  equityDrift: EquityDrift;
  
  // Calibration error (mean absolute error)
  calibrationError: number;
  
  // Learning eligibility
  learningEligible: boolean;
  eligibilityReasons: string[];
  
  // Regime distribution
  regimeDistribution: Record<RegimeName, number>;
  
  // Dominant tier
  dominantTier: TierName;
  dominantRegime: RegimeName;
}

// ═══════════════════════════════════════════════════════════════
// LEARNING AGGREGATOR INPUT
// ═══════════════════════════════════════════════════════════════

export interface LearningAggregatorInput {
  symbol: string;
  windowDays: number;
  preset?: string;
  role?: string;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT EMPTY PERFORMANCE
// ═══════════════════════════════════════════════════════════════

export function emptyTierPerformance(): TierPerformance {
  return {
    hitRate: 0,
    sharpe: 0,
    expectancy: 0,
    samples: 0,
    maxDD: 0,
    avgReturn: 0,
    winRate: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const MIN_SAMPLES_FOR_LEARNING = 30;
export const MAX_CALIBRATION_ERROR = 0.20;
export const MAX_CRISIS_SHARE = 0.50;
export const MIN_SHARPE_DELTA = -0.10;
