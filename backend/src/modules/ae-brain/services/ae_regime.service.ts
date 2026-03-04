/**
 * C2 — Regime Classifier Service
 * State machine for classifying market regime
 */

import type { AeStateVector } from '../contracts/ae_state.contract.js';
import type { AeRegime, AeRegimeResult } from '../contracts/ae_regime.contract.js';

/**
 * Classify regime based on state vector
 * 
 * Rules (priority order):
 * 1. RISK_OFF_STRESS: guardLevel >= 0.66 (CRISIS/BLOCK)
 * 2. DOLLAR_DOMINANCE: macroSigned > +0.20 AND guardLevel < 0.66
 * 3. LIQUIDITY_EXPANSION: macroSigned < -0.20 AND guardLevel < 0.33
 * 4. LIQUIDITY_CONTRACTION: macroSigned > +0.10 AND guardLevel >= 0.33
 * 5. DISINFLATION_PIVOT: macroSigned < -0.10 AND dxySignalSigned < -0.3
 * 6. NEUTRAL_MIXED: default
 */
export function classifyRegime(state: AeStateVector): AeRegimeResult {
  const { vector } = state;
  const reasons: string[] = [];
  let regime: AeRegime = 'NEUTRAL_MIXED';
  let confidence = 0.5;
  
  const g = vector.guardLevel;
  const m = vector.macroSigned;
  const d = vector.dxySignalSigned;
  
  // 1. RISK_OFF_STRESS (highest priority)
  if (g >= 0.66) {
    regime = 'RISK_OFF_STRESS';
    confidence = 0.85 + 0.15 * (g - 0.66) / 0.34;
    reasons.push(`Guard level elevated (${(g * 100).toFixed(0)}%)`);
    reasons.push('Crisis/Block mode active');
    if (m > 0.2) reasons.push('Tightening macro');
  }
  // 2. DOLLAR_DOMINANCE
  else if (m > 0.20 && g < 0.66) {
    regime = 'DOLLAR_DOMINANCE';
    confidence = 0.65 + 0.25 * (m - 0.20) / 0.80;
    reasons.push(`Hawkish macro signal (+${(m * 100).toFixed(0)}%)`);
    reasons.push('USD supportive environment');
    if (d > 0) reasons.push('DXY bias UP');
  }
  // 3. LIQUIDITY_EXPANSION
  else if (m < -0.20 && g < 0.33) {
    regime = 'LIQUIDITY_EXPANSION';
    confidence = 0.65 + 0.25 * Math.abs(m + 0.20) / 0.80;
    reasons.push(`Dovish macro signal (${(m * 100).toFixed(0)}%)`);
    reasons.push('Low stress environment');
    if (d < 0) reasons.push('DXY bias DOWN (risk-on)');
  }
  // 4. LIQUIDITY_CONTRACTION
  else if (m > 0.10 && g >= 0.33) {
    regime = 'LIQUIDITY_CONTRACTION';
    confidence = 0.55 + 0.25 * Math.min(m, g);
    reasons.push('Tightening with elevated stress');
    reasons.push(`Guard warning level (${(g * 100).toFixed(0)}%)`);
  }
  // 5. DISINFLATION_PIVOT
  else if (m < -0.10 && d < -0.3) {
    regime = 'DISINFLATION_PIVOT';
    confidence = 0.55 + 0.20 * Math.abs(m);
    reasons.push('Falling inflation signals');
    reasons.push('DXY weakness (potential pivot)');
  }
  // 6. NEUTRAL_MIXED
  else {
    regime = 'NEUTRAL_MIXED';
    confidence = 0.40 + 0.20 * (1 - Math.abs(m)) * (1 - g);
    reasons.push('No dominant regime');
    reasons.push('Mixed macro signals');
  }
  
  return {
    regime,
    confidence: Math.min(Math.max(confidence, 0), 1),
    reasons,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get regime impact on risk
 */
export function getRegimeRiskMultiplier(regime: AeRegime): number {
  switch (regime) {
    case 'RISK_OFF_STRESS':
      return 0.3;
    case 'LIQUIDITY_CONTRACTION':
      return 0.5;
    case 'DOLLAR_DOMINANCE':
      return 0.7;
    case 'NEUTRAL_MIXED':
      return 0.8;
    case 'DISINFLATION_PIVOT':
      return 0.9;
    case 'LIQUIDITY_EXPANSION':
      return 1.0;
    default:
      return 0.7;
  }
}
