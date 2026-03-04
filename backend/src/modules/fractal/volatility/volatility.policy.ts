/**
 * P1.4 — Volatility Policy Service
 * 
 * Maps regime → risk modifiers.
 * Does NOT change direction. Only scales risk.
 * 
 * Policy Table (Institutional):
 * | Regime    | Size Mult | Conf Penalty |
 * |-----------|-----------|--------------|
 * | LOW       | 1.05      | 0.00         |
 * | NORMAL    | 1.00      | 0.00         |
 * | HIGH      | 0.70      | 0.05         |
 * | EXPANSION | 0.50      | 0.10         |
 * | CRISIS    | 0.25      | 0.15         |
 */

import type { VolatilityRegime, VolatilityPolicy, VolatilityFeatures } from './volatility.types.js';

// ═══════════════════════════════════════════════════════════════
// POLICY TABLE
// ═══════════════════════════════════════════════════════════════

const POLICY_TABLE: Record<VolatilityRegime, VolatilityPolicy> = {
  LOW: {
    sizeMultiplier: 1.05,
    confidencePenaltyPp: 0.00,
  },
  NORMAL: {
    sizeMultiplier: 1.00,
    confidencePenaltyPp: 0.00,
  },
  HIGH: {
    sizeMultiplier: 0.70,
    confidencePenaltyPp: 0.05,
  },
  EXPANSION: {
    sizeMultiplier: 0.50,
    confidencePenaltyPp: 0.10,
  },
  CRISIS: {
    sizeMultiplier: 0.25,
    confidencePenaltyPp: 0.15,
  },
};

// ═══════════════════════════════════════════════════════════════
// POLICY GETTER
// ═══════════════════════════════════════════════════════════════

export function getVolatilityPolicy(regime: VolatilityRegime): VolatilityPolicy {
  return POLICY_TABLE[regime];
}

// ═══════════════════════════════════════════════════════════════
// BLOCKERS
// ═══════════════════════════════════════════════════════════════

export function getVolatilityBlockers(regime: VolatilityRegime, features: VolatilityFeatures): string[] {
  const blockers: string[] = [];

  // CRISIS adds hard blocker
  if (regime === 'CRISIS') {
    blockers.push('VOL_CRISIS');
  }

  // Extremely high z-score
  if (features.volZScore > 2.5) {
    blockers.push('EXTREME_VOL_SPIKE');
  }

  // Vol expansion with high absolute vol
  if (regime === 'EXPANSION' && features.rv30 > 0.8) {
    blockers.push('VOL_EXPANSION_HIGH');
  }

  return blockers;
}

// ═══════════════════════════════════════════════════════════════
// EXPLAIN
// ═══════════════════════════════════════════════════════════════

export function generateVolatilityExplain(
  regime: VolatilityRegime,
  features: VolatilityFeatures,
  policy: VolatilityPolicy
): string[] {
  const explain: string[] = [];

  // Regime
  explain.push(`Volatility regime: ${regime}`);

  // Features
  explain.push(`RV30: ${(features.rv30 * 100).toFixed(1)}% (annualized)`);
  explain.push(`RV90: ${(features.rv90 * 100).toFixed(1)}% (annualized)`);
  explain.push(`Vol Z-score: ${features.volZScore.toFixed(2)}`);
  explain.push(`ATR percentile: ${(features.atrPercentile * 100).toFixed(0)}%`);

  // Impact
  if (policy.sizeMultiplier !== 1.0) {
    explain.push(`Size modifier: ×${policy.sizeMultiplier.toFixed(2)}`);
  }
  if (policy.confidencePenaltyPp > 0) {
    explain.push(`Confidence penalty: -${(policy.confidencePenaltyPp * 100).toFixed(0)}pp`);
  }

  // Regime-specific notes
  switch (regime) {
    case 'LOW':
      explain.push('Quiet market conditions — slightly increased exposure allowed');
      break;
    case 'HIGH':
      explain.push('Elevated volatility — reducing exposure to manage risk');
      break;
    case 'EXPANSION':
      explain.push('Volatility expanding — significant risk reduction applied');
      break;
    case 'CRISIS':
      explain.push('Crisis-level volatility — minimal exposure recommended');
      break;
  }

  return explain;
}
