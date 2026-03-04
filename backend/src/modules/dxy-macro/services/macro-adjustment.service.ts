/**
 * MACRO ADJUSTMENT SERVICE — D6 v1
 * 
 * Computes macro adjustment multiplier based on Fed Funds regime.
 * 
 * ISOLATION: Does NOT modify DXY fractal core.
 * Only produces adjustment multiplier.
 * 
 * Logic:
 * - Tightening (rate hikes) → USD strengthens → amplify bullish DXY signals
 * - Easing (rate cuts) → USD weakens → dampen bullish DXY signals
 * - Neutral → no adjustment
 */

import { RateContext, MacroAdjustment, MACRO_CONFIG } from '../contracts/dxy-macro.contract.js';

// ═══════════════════════════════════════════════════════════════
// COMPUTE MACRO ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

export function computeMacroAdjustment(
  fractalForecastReturn: number,
  rateContext: RateContext
): MacroAdjustment {
  
  const isBullish = fractalForecastReturn > 0;
  const isBearish = fractalForecastReturn < 0;
  const isNeutral = Math.abs(fractalForecastReturn) < 0.001;
  
  // Default: no adjustment
  let multiplier = MACRO_CONFIG.NEUTRAL_MULT;
  let reason = 'Neutral regime, no adjustment';
  let direction: 'amplify' | 'dampen' | 'neutral' = 'neutral';
  
  if (rateContext.regime === 'tightening') {
    // Tightening = Fed hiking rates = USD strength expected
    // If fractal is bullish → amplify (macro confirms)
    // If fractal is bearish → also amplify (conviction in direction)
    
    if (isBullish) {
      multiplier = MACRO_CONFIG.TIGHTENING_AMPLIFY;
      reason = 'Tightening regime confirms bullish DXY, amplifying +15%';
      direction = 'amplify';
    } else if (isBearish) {
      // In tightening, bearish signal is counter-regime
      // We still amplify conviction but note the divergence
      multiplier = MACRO_CONFIG.TIGHTENING_AMPLIFY;
      reason = 'Tightening regime, amplifying conviction despite bearish fractal';
      direction = 'amplify';
    } else {
      reason = 'Tightening regime, neutral fractal, no adjustment';
    }
    
  } else if (rateContext.regime === 'easing') {
    // Easing = Fed cutting rates = USD weakness expected
    // Dampen bullish signals, amplify bearish signals
    
    if (isBullish) {
      multiplier = MACRO_CONFIG.EASING_DAMPEN;
      reason = 'Easing regime dampens bullish DXY, reducing -15%';
      direction = 'dampen';
    } else if (isBearish) {
      multiplier = MACRO_CONFIG.TIGHTENING_AMPLIFY; // Amplify bearish in easing
      reason = 'Easing regime confirms bearish DXY, amplifying +15%';
      direction = 'amplify';
    } else {
      reason = 'Easing regime, neutral fractal, no adjustment';
    }
    
  } else {
    // Neutral regime
    reason = `Neutral regime (delta12m=${rateContext.delta12m}), no macro adjustment`;
    direction = 'neutral';
  }
  
  return {
    multiplier,
    reason,
    regime: rateContext.regime,
    direction,
  };
}

// ═══════════════════════════════════════════════════════════════
// APPLY ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

export function applyMacroAdjustment(
  originalReturn: number,
  adjustment: MacroAdjustment
): number {
  return Math.round(originalReturn * adjustment.multiplier * 10000) / 10000;
}
