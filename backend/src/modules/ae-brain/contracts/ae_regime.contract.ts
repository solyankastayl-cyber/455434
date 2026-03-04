/**
 * C2 — Regime Classifier Contract
 * State machine for market regime classification
 */

export type AeRegime =
  | 'LIQUIDITY_EXPANSION'
  | 'LIQUIDITY_CONTRACTION'
  | 'DOLLAR_DOMINANCE'
  | 'DISINFLATION_PIVOT'
  | 'RISK_OFF_STRESS'
  | 'NEUTRAL_MIXED';

export interface AeRegimeResult {
  regime: AeRegime;
  confidence: number;     // [0..1]
  reasons: string[];
  timestamp: string;
}

// Regime descriptions for documentation
export const REGIME_DESCRIPTIONS: Record<AeRegime, string> = {
  'LIQUIDITY_EXPANSION': 'Fed easing, low stress, risk-on environment',
  'LIQUIDITY_CONTRACTION': 'Fed tightening, credit stress rising',
  'DOLLAR_DOMINANCE': 'Strong USD, hawkish policy, SPX pressure',
  'DISINFLATION_PIVOT': 'Falling inflation, potential policy shift',
  'RISK_OFF_STRESS': 'Crisis mode, high VIX, credit spike',
  'NEUTRAL_MIXED': 'No dominant regime, mixed signals',
};
