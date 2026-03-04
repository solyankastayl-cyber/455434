/**
 * BTC CASCADE OOS VALIDATION — D2.1
 * 
 * Compares baseline BTC (no cascade) vs BTC cascade (full chain)
 * on out-of-sample period 2021-2025.
 * 
 * PURPOSE: Prove cascade improves risk profile, not just "looks nice".
 * 
 * @version D2.1
 */

// ═══════════════════════════════════════════════════════════════
// VALIDATION METRICS
// ═══════════════════════════════════════════════════════════════

export interface ValidationMetrics {
  /** Hit rate (% of correct direction predictions) */
  hitRate: number;
  /** Bias (average prediction vs actual difference) */
  bias: number;
  /** Final equity (compounded) */
  equityFinal: number;
  /** Maximum drawdown */
  maxDrawdown: number;
  /** Volatility (daily std) */
  volatility: number;
  /** Average exposure [0..1] */
  avgExposure: number;
  /** Number of trades */
  tradeCount: number;
  /** Win/Loss ratio */
  winLossRatio: number;
  /** Profitable trades count */
  wins: number;
  /** Losing trades count */
  losses: number;
}

export interface ExposureDistribution {
  /** % of time at NONE guard */
  none: number;
  /** % of time at WARN guard */
  warn: number;
  /** % of time at CRISIS guard */
  crisis: number;
  /** % of time at BLOCK guard */
  block: number;
}

export interface PeriodBreakdown {
  period: string;
  from: string;
  to: string;
  baseline: ValidationMetrics;
  cascade: ValidationMetrics;
  delta: MetricsDelta;
}

export interface MetricsDelta {
  equityDiff: number;
  equityDiffPct: number;
  maxDDDiff: number;
  maxDDDiffPct: number;
  volDiff: number;
  volDiffPct: number;
  hitRateDiff: number;
}

export interface AcceptanceCriteria {
  passed: boolean;
  reasons: string[];
  criteria: {
    maxDDImproved10Pct: boolean;
    equityImproved5Pct: boolean;
    volImproved10Pct: boolean;
    biasAcceptable: boolean;
    hitRateNotDegraded: boolean;
  };
}

export interface ValidationResult {
  ok: boolean;
  period: { from: string; to: string };
  focus: string;
  baseline: ValidationMetrics;
  cascade: ValidationMetrics;
  cascadeExtra: {
    exposureDistribution: ExposureDistribution;
    avgSizeMultiplier: number;
  };
  delta: MetricsDelta;
  acceptance: AcceptanceCriteria;
  breakdown: PeriodBreakdown[];
  computedAt: string;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════
// DAILY SIGNAL RECORD
// ═══════════════════════════════════════════════════════════════

export interface DailySignal {
  date: string;
  /** BTC price */
  price: number;
  /** Daily return (t vs t-1) */
  dailyReturn: number;
  /** BTC core direction: 1 (LONG), -1 (SHORT), 0 (HOLD) */
  direction: number;
  /** Baseline size (always 1.0) */
  baselineSize: number;
  /** Cascade adjusted size */
  cascadeSize: number;
  /** Guard level */
  guardLevel: string;
  /** Cascade multipliers */
  mStress: number;
  mScenario: number;
  mNovel: number;
  mSPX: number;
}
