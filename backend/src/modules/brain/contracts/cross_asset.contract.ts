/**
 * P9.0 — Cross-Asset Correlation Regime Contract
 * 
 * Types for CrossAssetPack: correlations, regime labels, diagnostics.
 */

export type CrossAssetRegime =
  | 'RISK_ON_SYNC'
  | 'RISK_OFF_SYNC'
  | 'FLIGHT_TO_QUALITY'
  | 'DECOUPLED'
  | 'MIXED';

export type WindowSize = 20 | 60 | 120;

export const WINDOW_SIZES: WindowSize[] = [20, 60, 120];

export const ASSET_PAIRS = [
  'btc_spx', 'btc_dxy', 'spx_dxy',
  'btc_gold', 'spx_gold', 'dxy_gold',
] as const;

export type AssetPair = typeof ASSET_PAIRS[number];

export interface CrossAssetCorrWindow {
  windowDays: WindowSize;
  corr_btc_spx: number;
  corr_btc_dxy: number;
  corr_spx_dxy: number;
  corr_btc_gold: number;
  corr_spx_gold: number;
  corr_dxy_gold: number;
  sampleN: number;
}

export interface CrossAssetPack {
  asOf: string;
  windows: CrossAssetCorrWindow[];
  regime: {
    label: CrossAssetRegime;
    confidence: number;
    rationale: string[];
  };
  diagnostics: {
    decoupleScore: number;
    signFlipCount: number;
    corrStability: number;
    contagionScore: number;
  };
  evidence: {
    keyCorrs: Record<string, number>;
    thresholds: Record<string, number>;
  };
}

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFICATION THRESHOLDS
// ═══════════════════════════════════════════════════════════════

export const REGIME_THRESHOLDS = {
  RISK_ON_SYNC: {
    corr_btc_spx_min: 0.35,
    corr_dxy_spx_max: -0.15,
    corr_gold_spx_max: 0,
  },
  RISK_OFF_SYNC: {
    corr_btc_spx_min: 0.35,
    corr_dxy_risk_min: 0.10,
  },
  FLIGHT_TO_QUALITY: {
    corr_gold_risk_max: -0.10,
    corr_dxy_gold_max: -0.10,
  },
  DECOUPLED: {
    corr_btc_spx_max: 0.15,
    decouple_score_min: 0.3,
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateCrossAssetPack(pack: CrossAssetPack): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!pack.asOf) errors.push('Missing asOf');
  if (!pack.windows || pack.windows.length === 0) errors.push('Missing windows');
  if (!pack.regime?.label) errors.push('Missing regime label');

  for (const w of pack.windows) {
    const corrFields = [
      w.corr_btc_spx, w.corr_btc_dxy, w.corr_spx_dxy,
      w.corr_btc_gold, w.corr_spx_gold, w.corr_dxy_gold,
    ];
    for (const c of corrFields) {
      if (isNaN(c)) errors.push(`NaN correlation in ${w.windowDays}d window`);
    }
    if (w.sampleN < w.windowDays * 0.5) {
      errors.push(`Insufficient samples in ${w.windowDays}d window: ${w.sampleN}`);
    }
  }

  if (pack.regime.confidence < 0 || pack.regime.confidence > 1) {
    errors.push(`Invalid confidence: ${pack.regime.confidence}`);
  }

  return { valid: errors.length === 0, errors };
}
