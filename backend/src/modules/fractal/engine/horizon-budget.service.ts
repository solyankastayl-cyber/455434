/**
 * BLOCK 39.1 — Horizon Budget Control Service
 * 
 * Prevents single horizon dominance in multi-horizon assembly.
 * Redistributes excess contribution proportionally.
 */

import {
  HorizonKey,
  HorizonBudgetConfig,
  HorizonBudgetResult,
  DEFAULT_HORIZON_BUDGET_CONFIG,
} from '../contracts/institutional.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// ═══════════════════════════════════════════════════════════════
// Horizon Budget Application
// ═══════════════════════════════════════════════════════════════

export interface HorizonScore {
  horizon: HorizonKey;
  score: number;       // signed score
  weight: number;      // 0..1 weight
}

/**
 * Apply horizon budget caps to prevent single-horizon dominance
 * 
 * @param scores - raw horizon scores with weights
 * @param cfg - budget configuration
 */
export function applyHorizonBudget(
  scores: HorizonScore[],
  cfg: HorizonBudgetConfig = DEFAULT_HORIZON_BUDGET_CONFIG
): HorizonBudgetResult {
  // Calculate raw contributions (absolute)
  const totalAbsContrib = scores.reduce(
    (sum, s) => sum + Math.abs(s.score * s.weight), 
    0
  );
  
  if (totalAbsContrib === 0) {
    return {
      original: { 7: 0, 14: 0, 30: 0, 60: 0 },
      capped: { 7: 0, 14: 0, 30: 0, 60: 0 },
      redistributed: { 7: 0, 14: 0, 30: 0, 60: 0 },
      dominantHorizon: null,
      dominancePct: 0,
      wasCapped: false,
    };
  }
  
  // Original contributions (normalized)
  const original: Record<HorizonKey, number> = { 7: 0, 14: 0, 30: 0, 60: 0 };
  for (const s of scores) {
    original[s.horizon] = Math.abs(s.score * s.weight) / totalAbsContrib;
  }
  
  // Find dominant horizon
  let dominantHorizon: HorizonKey | null = null;
  let maxContrib = 0;
  for (const h of [7, 14, 30, 60] as HorizonKey[]) {
    if (original[h] > maxContrib) {
      maxContrib = original[h];
      dominantHorizon = h;
    }
  }
  const dominancePct = maxContrib;
  
  // Apply caps
  const capped: Record<HorizonKey, number> = { 7: 0, 14: 0, 30: 0, 60: 0 };
  let totalExcess = 0;
  let wasCapped = false;
  
  for (const h of [7, 14, 30, 60] as HorizonKey[]) {
    const cap = Math.min(cfg.caps[h], cfg.maxDominance);
    if (original[h] > cap) {
      totalExcess += original[h] - cap;
      capped[h] = cap;
      wasCapped = true;
    } else {
      capped[h] = original[h];
    }
  }
  
  // Redistribute excess proportionally
  const redistributed: Record<HorizonKey, number> = { ...capped };
  
  if (cfg.redistributeExcess && totalExcess > 0) {
    // Calculate redistribution pool (horizons below their cap)
    const belowCap: HorizonKey[] = [];
    let belowCapTotal = 0;
    
    for (const h of [7, 14, 30, 60] as HorizonKey[]) {
      const cap = Math.min(cfg.caps[h], cfg.maxDominance);
      if (capped[h] < cap) {
        belowCap.push(h);
        belowCapTotal += capped[h];
      }
    }
    
    // Distribute excess
    if (belowCapTotal > 0) {
      for (const h of belowCap) {
        const cap = Math.min(cfg.caps[h], cfg.maxDominance);
        const share = capped[h] / belowCapTotal;
        const addition = Math.min(totalExcess * share, cap - capped[h]);
        redistributed[h] = capped[h] + addition;
      }
    }
  }
  
  // Normalize redistributed to sum to 1
  const redistTotal = Object.values(redistributed).reduce((a, b) => a + b, 0);
  if (redistTotal > 0) {
    for (const h of [7, 14, 30, 60] as HorizonKey[]) {
      redistributed[h] = redistributed[h] / redistTotal;
    }
  }
  
  return {
    original,
    capped,
    redistributed,
    dominantHorizon,
    dominancePct: Math.round(dominancePct * 1000) / 1000,
    wasCapped,
  };
}

/**
 * Apply budget to assembled score
 * Returns budget-adjusted score
 */
export function assembleWithBudget(
  scores: HorizonScore[],
  cfg: HorizonBudgetConfig = DEFAULT_HORIZON_BUDGET_CONFIG
): {
  assembledScore: number;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  budgetResult: HorizonBudgetResult;
} {
  const budgetResult = applyHorizonBudget(scores, cfg);
  
  // Recalculate assembled score using redistributed weights
  let assembledScore = 0;
  for (const s of scores) {
    const adjustedWeight = budgetResult.redistributed[s.horizon];
    assembledScore += s.score * adjustedWeight;
  }
  
  const direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 
    assembledScore > 0.02 ? 'LONG' :
    assembledScore < -0.02 ? 'SHORT' : 'NEUTRAL';
  
  return {
    assembledScore: Math.round(assembledScore * 10000) / 10000,
    direction,
    budgetResult,
  };
}
