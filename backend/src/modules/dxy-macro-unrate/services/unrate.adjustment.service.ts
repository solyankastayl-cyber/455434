/**
 * UNRATE ADJUSTMENT SERVICE — D6 v3
 * 
 * Computes unemployment-based macro adjustment multiplier.
 * 
 * ISOLATION: Does NOT modify DXY fractal core.
 * Only produces adjustment multiplier.
 * 
 * Logic:
 * - Rising unemployment = risk-off sentiment = USD strength (safe haven)
 * - Falling unemployment = risk-on sentiment = USD pressure
 */

import { UnrateContext, UnrateAdjustment, UNRATE_CONFIG } from '../unrate.types.js';

// ═══════════════════════════════════════════════════════════════
// COMPUTE UNRATE ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

export function computeUnrateAdjustment(unrateContext: UnrateContext): UnrateAdjustment {
  const { current, delta3m, delta12m, trend, regime, pressure } = unrateContext;
  
  // Multiplier: 1 + pressure * 0.10, clamped to 0.90-1.10
  const rawMultiplier = 1 + pressure * UNRATE_CONFIG.UNRATE_WEIGHT;
  const multiplier = Math.max(
    UNRATE_CONFIG.MIN_MULTIPLIER,
    Math.min(UNRATE_CONFIG.MAX_MULTIPLIER, rawMultiplier)
  );
  
  // Build explanation
  const reasons: string[] = [];
  
  // Current level context
  if (regime === 'TIGHT') {
    reasons.push(`Labor market tight (${current}% unemployment, below ${UNRATE_CONFIG.TIGHT_THRESHOLD}%).`);
  } else if (regime === 'STRESS') {
    reasons.push(`Labor market stressed (${current}% unemployment, above ${UNRATE_CONFIG.STRESS_THRESHOLD}%).`);
  } else {
    reasons.push(`Labor market normal (${current}% unemployment).`);
  }
  
  // Trend context
  if (trend === 'UP') {
    reasons.push(`Unemployment rising (+${delta3m}pp over 3M). Risk-off sentiment supports DXY.`);
  } else if (trend === 'DOWN') {
    reasons.push(`Unemployment falling (${delta3m}pp over 3M). Risk-on sentiment pressures DXY.`);
  } else {
    reasons.push(`Unemployment stable (${delta3m >= 0 ? '+' : ''}${delta3m}pp over 3M).`);
  }
  
  // 12-month change
  if (Math.abs(delta12m) >= 0.5) {
    const direction = delta12m > 0 ? 'increased' : 'decreased';
    reasons.push(`12M change: ${direction} by ${Math.abs(delta12m)}pp.`);
  }
  
  return {
    multiplier: Math.round(multiplier * 10000) / 10000,
    pressure,
    reasons,
  };
}

// ═══════════════════════════════════════════════════════════════
// COMBINE ALL MACRO MULTIPLIERS (Fed + CPI + UNRATE)
// ═══════════════════════════════════════════════════════════════

export function combineAllMacroMultipliers(
  fedMultiplier: number,
  cpiMultiplier: number,
  unrateMultiplier: number
): number {
  // Combined: fed × cpi × unrate, clamped to 0.70-1.30
  const combined = fedMultiplier * cpiMultiplier * unrateMultiplier;
  return Math.max(0.70, Math.min(1.30, Math.round(combined * 10000) / 10000));
}
