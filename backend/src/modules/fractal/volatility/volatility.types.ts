/**
 * P1.4 — Volatility Regime Types
 * 
 * Institutional volatility classification.
 * Does NOT affect direction — only risk scaling.
 */

export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXPANSION' | 'CRISIS';

export interface VolatilityFeatures {
  rv30: number;           // Realized volatility 30d (annualized)
  rv90: number;           // Realized volatility 90d (annualized)
  rv365Mean: number;      // Mean RV over 365d (for z-score)
  rv365Std: number;       // Std of RV over 365d
  atr14: number;          // ATR(14) absolute
  atr14Pct: number;       // ATR(14) as % of price
  atrPercentile: number;  // ATR percentile in 365d window
  volRatio: number;       // RV30 / RV90
  volZScore: number;      // (RV30 - RV365Mean) / RV365Std
}

export interface VolatilityPolicy {
  sizeMultiplier: number;       // 0.25 - 1.15
  confidencePenaltyPp: number;  // 0 - 0.15 (percentage points)
}

export interface VolatilityResult {
  regime: VolatilityRegime;
  features: VolatilityFeatures;
  policy: VolatilityPolicy;
  blockers: string[];
  explain: string[];
}

export interface VolatilityApplied {
  sizeBefore: number;
  sizeAfter: number;
  confBefore: number;
  confAfter: number;
}

// Candle input type
export interface DailyCandle {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
