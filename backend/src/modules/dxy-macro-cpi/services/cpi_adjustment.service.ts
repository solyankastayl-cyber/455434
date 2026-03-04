/**
 * CPI ADJUSTMENT SERVICE — D6 v2
 * 
 * Computes CPI-based macro adjustment multiplier.
 * 
 * ISOLATION: Does NOT modify DXY fractal core.
 * Only produces adjustment multiplier.
 * 
 * Logic:
 * - REHEATING inflation → USD tends to stay supported (higher rates expected)
 * - COOLING inflation → USD pressure may ease (lower rates expected)
 * - STABLE → minimal adjustment
 */

import { CpiContext, CpiAdjustment, CPI_CONFIG } from '../contracts/cpi.contract.js';

// ═══════════════════════════════════════════════════════════════
// COMPUTE CPI ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

export function computeCpiAdjustment(cpiContext: CpiContext): CpiAdjustment {
  const { regime, pressure, core } = cpiContext;
  
  // CPI score: 0.10 * pressure
  const score = CPI_CONFIG.CPI_SCORE_WEIGHT * pressure;
  
  // Multiplier: clamp(1 + score, 0.90, 1.10)
  const rawMultiplier = 1 + score;
  const multiplier = Math.max(
    CPI_CONFIG.MIN_MULTIPLIER,
    Math.min(CPI_CONFIG.MAX_MULTIPLIER, rawMultiplier)
  );
  
  // Build explanation
  const explain: string[] = [];
  
  // Format percentages for readability
  const coreYoyPct = (core.yoy * 100).toFixed(2);
  const ann3mPct = (core.ann3m * 100).toFixed(2);
  
  if (regime === 'REHEATING') {
    explain.push(`Inflation is reheating (core YoY ${coreYoyPct}%, 3M ann. ${ann3mPct}%).`);
    explain.push('DXY tends to stay supported as higher rates expected.');
  } else if (regime === 'COOLING') {
    explain.push(`Inflation is cooling (core YoY ${coreYoyPct}%, 3M ann. ${ann3mPct}%).`);
    explain.push('DXY pressure may ease as rate cuts become more likely.');
  } else {
    explain.push(`Inflation is stable (core YoY ${coreYoyPct}%).`);
    explain.push('No strong CPI-driven bias.');
  }
  
  // Add pressure context
  if (pressure > 0.3) {
    explain.push(`Inflation pressure elevated (+${(pressure * 100).toFixed(0)}% above target zone).`);
  } else if (pressure < -0.3) {
    explain.push(`Inflation pressure subdued (${(pressure * 100).toFixed(0)}% below target zone).`);
  }
  
  return {
    multiplier: Math.round(multiplier * 10000) / 10000,
    score: Math.round(score * 10000) / 10000,
    explain,
  };
}

// ═══════════════════════════════════════════════════════════════
// COMBINE CPI WITH OTHER ADJUSTMENTS
// ═══════════════════════════════════════════════════════════════

export function combineMacroMultipliers(
  fedMultiplier: number,
  cpiMultiplier: number
): number {
  // Combined: fedMultiplier * cpiMultiplier, clamped to 0.80-1.20
  const combined = fedMultiplier * cpiMultiplier;
  return Math.max(0.80, Math.min(1.20, Math.round(combined * 10000) / 10000));
}
