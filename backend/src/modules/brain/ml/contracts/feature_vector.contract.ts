/**
 * P8.0 — Feature Vector Contract
 * 
 * 53 features for institutional-grade quantile forecasting.
 * All features: normalized [-1..+1], no NaN, asOf-safe.
 */

export const FEATURES_VERSION = 'fv1_53';
export const FEATURE_COUNT = 53;

// ═══════════════════════════════════════════════════════════════
// FEATURE NAMES (ordered)
// ═══════════════════════════════════════════════════════════════

export const FEATURE_NAMES = [
  // 1-4: Macro Score
  'macro_scoreSigned',
  'macro_confidence',
  'macro_driver_concentration',
  'macro_weights_entropy',
  
  // 5-11: Regime Probabilities
  'regime_p_easing',
  'regime_p_tightening',
  'regime_p_stress',
  'regime_p_neutral',
  'regime_p_mixed',
  'regime_persistence',
  'regime_flip_risk',
  
  // 12-16: Liquidity
  'liq_impulse',
  'liq_confidence',
  'liq_regime_expansion',
  'liq_regime_neutral',
  'liq_regime_contraction',
  
  // 17-23: Guard
  'guard_level',
  'guard_none',
  'guard_warn',
  'guard_crisis',
  'guard_block',
  'guard_days_in_state',
  'guard_cooldown_active',
  
  // 24-27: Returns
  'ret_5d',
  'ret_20d',
  'ret_60d',
  'ret_120d',
  
  // 28-30: Volatility
  'vol_20d',
  'vol_60d',
  'vol_ratio_20_60',
  
  // 31-33: Trend / Momentum
  'trend_slope_50d',
  'ema_gap_20_60',
  'breakout_60d',
  
  // 34-36: Drawdown / Stress
  'dd_90d',
  'dd_180d',
  'vol_spike',
  
  // 37-41: Cross-asset
  'corr_dxy_spx_60d',
  'corr_dxy_btc_60d',
  'corr_spx_btc_60d',
  'rel_vol_dxy_spx',
  'rel_vol_btc_spx',
  
  // 42-53: Top 3 Drivers (4 features each)
  'drv1_weight',
  'drv1_corr',
  'drv1_lag_days',
  'drv1_z',
  'drv2_weight',
  'drv2_corr',
  'drv2_lag_days',
  'drv2_z',
  'drv3_weight',
  'drv3_corr',
  'drv3_lag_days',
  'drv3_z',
] as const;

export type FeatureName = typeof FEATURE_NAMES[number];

// ═══════════════════════════════════════════════════════════════
// CONTRACTS
// ═══════════════════════════════════════════════════════════════

export interface FeatureIntegrity {
  inputsHash: string;
  noLookahead: boolean;
  computeTimeMs: number;
}

export interface FeatureVectorResponse {
  asset: string;
  asOf: string;
  featuresVersion: string;
  featureCount: number;
  vector: number[];
  named: Record<FeatureName, number>;
  integrity: FeatureIntegrity;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateFeatureVector(vector: number[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Check length
  if (vector.length !== FEATURE_COUNT) {
    errors.push(`Expected ${FEATURE_COUNT} features, got ${vector.length}`);
  }
  
  // Check for NaN
  const nanIndices = vector
    .map((v, i) => isNaN(v) ? i : -1)
    .filter(i => i >= 0);
  
  if (nanIndices.length > 0) {
    errors.push(`NaN values at indices: ${nanIndices.join(', ')}`);
  }
  
  // Check range [-1, +1] for most features
  const outOfRangeIndices = vector
    .map((v, i) => (Math.abs(v) > 1.01) ? i : -1)
    .filter(i => i >= 0);
  
  if (outOfRangeIndices.length > 0) {
    errors.push(`Out of range [-1,+1] at indices: ${outOfRangeIndices.join(', ')}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Clip value to range
 */
export function clip(value: number, min: number, max: number): number {
  if (isNaN(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

/**
 * Scale value from [inMin, inMax] to [-1, +1]
 */
export function scale(value: number, inMin: number, inMax: number): number {
  if (isNaN(value)) return 0;
  const clipped = clip(value, inMin, inMax);
  return ((clipped - inMin) / (inMax - inMin)) * 2 - 1;
}

/**
 * One-hot encode categorical value
 */
export function oneHot(value: string, categories: string[]): number[] {
  return categories.map(c => c === value ? 1 : 0);
}
