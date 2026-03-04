/**
 * P1.4 — Volatility Regime Classifier
 * 
 * Deterministic regime classification.
 * No ML. No retraining. Stable.
 * 
 * Regimes:
 * - LOW: Quiet market (RV30 < P25)
 * - NORMAL: Base state
 * - HIGH: Elevated volatility (RV30 > P75)
 * - EXPANSION: Vol growing (RV30 > RV90 * 1.15)
 * - CRISIS: Extreme (RV30 > P95)
 */

import type { VolatilityFeatures, VolatilityRegime } from './volatility.types.js';

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS (Institutional)
// ═══════════════════════════════════════════════════════════════

const THRESHOLDS = {
  // ATR percentile thresholds
  ATR_LOW: 0.20,
  ATR_HIGH: 0.80,
  ATR_CRISIS: 0.95,
  
  // Z-score thresholds
  Z_LOW: -1.0,
  Z_HIGH: 1.0,
  Z_CRISIS: 2.0,
  
  // Vol ratio for expansion detection
  EXPANSION_RATIO: 1.15,
  
  // RV percentiles (relative to 365d distribution)
  RV_P25_FACTOR: 0.7,  // Below 70% of mean = LOW
  RV_P75_FACTOR: 1.3,  // Above 130% of mean = HIGH
  RV_P95_FACTOR: 1.8,  // Above 180% of mean = CRISIS
};

// ═══════════════════════════════════════════════════════════════
// CLASSIFIER
// ═══════════════════════════════════════════════════════════════

export function classifyVolatilityRegime(features: VolatilityFeatures): VolatilityRegime {
  const { rv30, rv90, rv365Mean, atrPercentile, volRatio, volZScore } = features;

  // CRISIS: Extreme volatility
  // Either ATR in top 5% OR z-score > 2 OR RV30 > 180% of mean
  if (
    atrPercentile > THRESHOLDS.ATR_CRISIS ||
    volZScore > THRESHOLDS.Z_CRISIS ||
    (rv365Mean > 0 && rv30 > rv365Mean * THRESHOLDS.RV_P95_FACTOR)
  ) {
    return 'CRISIS';
  }

  // EXPANSION: Volatility growing rapidly
  // RV30 significantly higher than RV90
  if (volRatio > THRESHOLDS.EXPANSION_RATIO && volZScore > 0.5) {
    return 'EXPANSION';
  }

  // HIGH: Elevated volatility
  // ATR in top 20% OR z-score > 1 OR RV30 > 130% of mean
  if (
    atrPercentile > THRESHOLDS.ATR_HIGH ||
    volZScore > THRESHOLDS.Z_HIGH ||
    (rv365Mean > 0 && rv30 > rv365Mean * THRESHOLDS.RV_P75_FACTOR)
  ) {
    return 'HIGH';
  }

  // LOW: Quiet market
  // ATR in bottom 20% AND z-score < -1 OR RV30 < 70% of mean
  if (
    atrPercentile < THRESHOLDS.ATR_LOW &&
    (volZScore < THRESHOLDS.Z_LOW || (rv365Mean > 0 && rv30 < rv365Mean * THRESHOLDS.RV_P25_FACTOR))
  ) {
    return 'LOW';
  }

  // NORMAL: Base state
  return 'NORMAL';
}

// ═══════════════════════════════════════════════════════════════
// REGIME LABELS (for UI)
// ═══════════════════════════════════════════════════════════════

export function getRegimeLabel(regime: VolatilityRegime): string {
  const labels: Record<VolatilityRegime, string> = {
    LOW: 'Low Volatility',
    NORMAL: 'Normal',
    HIGH: 'High Volatility',
    EXPANSION: 'Vol Expansion',
    CRISIS: 'Crisis',
  };
  return labels[regime];
}

export function getRegimeColor(regime: VolatilityRegime): string {
  const colors: Record<VolatilityRegime, string> = {
    LOW: '#22c55e',      // green
    NORMAL: '#6b7280',   // gray
    HIGH: '#f59e0b',     // amber
    EXPANSION: '#ef4444', // red
    CRISIS: '#dc2626',    // dark red
  };
  return colors[regime];
}
