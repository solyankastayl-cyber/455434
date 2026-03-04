/**
 * SPX CONSENSUS ENGINE — Weights Calculator
 * 
 * BLOCK B5.5 — Tier and horizon weight computation
 * 
 * Base weights: STRUCTURE 50%, TACTICAL 30%, TIMING 20%
 * Modifiers based on vol regime, phase, divergence grade.
 */

import type { HorizonInput, Tier, SpxHorizon } from './spx-consensus.types.js';

// ═══════════════════════════════════════════════════════════════
// BASE WEIGHTS
// ═══════════════════════════════════════════════════════════════

const BASE_TIER_WEIGHTS: Record<Tier, number> = {
  STRUCTURE: 0.50,
  TACTICAL: 0.30,
  TIMING: 0.20,
};

const HORIZON_TO_TIER: Record<SpxHorizon, Tier> = {
  '7d': 'TIMING',
  '14d': 'TIMING',
  '30d': 'TACTICAL',
  '90d': 'TACTICAL',
  '180d': 'STRUCTURE',
  '365d': 'STRUCTURE',
};

// Horizons within each tier split the tier weight
const HORIZONS_PER_TIER: Record<Tier, SpxHorizon[]> = {
  TIMING: ['7d', '14d'],
  TACTICAL: ['30d', '90d'],
  STRUCTURE: ['180d', '365d'],
};

// ═══════════════════════════════════════════════════════════════
// WEIGHT BUILDER
// ═══════════════════════════════════════════════════════════════

export interface WeightModifiers {
  volShock: boolean;           // VOL_SHOCK flag present
  bearDrawdown: boolean;       // Current phase is BEAR_DRAWDOWN
  divergenceGrades: Record<SpxHorizon, string>; // Grade per horizon
}

export function buildSpxWeights(
  horizons: HorizonInput[],
  modifiers?: Partial<WeightModifiers>
): Record<SpxHorizon, number> {
  const result: Record<SpxHorizon, number> = {} as any;
  
  // Get tier weights with modifiers
  let tierWeights = { ...BASE_TIER_WEIGHTS };
  
  // VOL_SHOCK: boost STRUCTURE, reduce TIMING
  if (modifiers?.volShock) {
    tierWeights.STRUCTURE *= 1.20;
    tierWeights.TIMING *= 0.70;
  }
  
  // BEAR_DRAWDOWN: boost STRUCTURE slightly
  if (modifiers?.bearDrawdown) {
    tierWeights.STRUCTURE *= 1.10;
  }
  
  // Normalize tier weights to sum to 1
  const tierSum = tierWeights.STRUCTURE + tierWeights.TACTICAL + tierWeights.TIMING;
  tierWeights.STRUCTURE /= tierSum;
  tierWeights.TACTICAL /= tierSum;
  tierWeights.TIMING /= tierSum;
  
  // Distribute tier weights to horizons
  for (const tier of Object.keys(HORIZONS_PER_TIER) as Tier[]) {
    const horizonsInTier = HORIZONS_PER_TIER[tier];
    const presentHorizons = horizons.filter(h => horizonsInTier.includes(h.horizon));
    
    if (presentHorizons.length === 0) continue;
    
    // Split tier weight among present horizons
    const baseWeight = tierWeights[tier] / presentHorizons.length;
    
    for (const h of presentHorizons) {
      let weight = baseWeight;
      
      // Apply divergence grade penalty
      const grade = modifiers?.divergenceGrades?.[h.horizon] || h.divergenceGrade || 'B';
      weight *= gradePenalty(grade);
      
      result[h.horizon] = Math.round(weight * 10000) / 10000;
    }
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// GRADE PENALTY
// ═══════════════════════════════════════════════════════════════

function gradePenalty(grade: string): number {
  switch (grade) {
    case 'A': return 1.05;
    case 'B': return 1.00;
    case 'C': return 0.95;
    case 'D': return 0.85;
    case 'F': return 0.70;
    default: return 1.00;
  }
}

export function getTierForHorizon(horizon: SpxHorizon): Tier {
  return HORIZON_TO_TIER[horizon];
}

export default buildSpxWeights;
