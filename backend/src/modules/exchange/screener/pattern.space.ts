/**
 * BLOCK 1.4.4 — Pattern Space (Normalization)
 * =============================================
 * Normalizes AltFeatureVector for similarity calculations.
 */

import type { AltFeatureVector } from './contracts/alt.feature.vector.js';

/**
 * Normalize vector to [-1, 1] or [0, 1] range for ML
 */
export function normalizeVector(v: AltFeatureVector): number[] {
  return [
    v.rsi / 100,                              // 0..1
    clamp(v.rsiSlope, -1, 1),                 // -1..1
    clamp(v.rsiZ / 3, -1, 1),                 // z-score clamped
    clamp(v.macdHist / 2, -1, 1),             // MACD
    clamp(v.momentum1h / 10, -1, 1),          // % clamped
    clamp(v.momentum4h / 20, -1, 1),
    clamp(v.momentum24h / 30, -1, 1),

    clamp(v.volumeZ / 3, -1, 1),
    clamp(v.volumeTrend, -1, 1),
    clamp(v.orderImbalance, -1, 1),

    clamp(v.fundingScore, -1, 1),             // Already normalized
    clamp(v.fundingTrend, -1, 1),
    clamp(v.oiDelta / 50, -1, 1),             // % clamped
    clamp(v.oiZ / 3, -1, 1),
    clamp(v.longBias, -1, 1),

    clamp(v.liquidationPressure, -1, 1),
    clamp(v.liquidationZ / 3, -1, 1),
    clamp(v.cascadeRisk, 0, 1),

    clamp(v.volatility / 10, 0, 1),           // ATR % clamped
    clamp(v.volatilityZ / 3, -1, 1),
    clamp(v.trendStrength, 0, 1),

    clamp(v.breakoutScore, 0, 1),
    clamp(v.meanrevScore, 0, 1),
    clamp(v.squeezeScore, 0, 1),

    clamp(v.btcCorrelation, -1, 1),
    clamp(v.btcDominanceDelta / 5, -1, 1),
  ];
}

/**
 * Get feature names in order (for explainability)
 */
export const FEATURE_NAMES = [
  'RSI',
  'RSI Slope',
  'RSI Z-Score',
  'MACD Histogram',
  'Momentum 1h',
  'Momentum 4h',
  'Momentum 24h',
  'Volume Z-Score',
  'Volume Trend',
  'Order Imbalance',
  'Funding Score',
  'Funding Trend',
  'OI Delta',
  'OI Z-Score',
  'Long Bias',
  'Liquidation Pressure',
  'Liquidation Z-Score',
  'Cascade Risk',
  'Volatility',
  'Volatility Z-Score',
  'Trend Strength',
  'Breakout Score',
  'Mean Reversion Score',
  'Squeeze Score',
  'BTC Correlation',
  'BTC Dominance Delta',
];

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

console.log('[Screener] Pattern Space loaded');
