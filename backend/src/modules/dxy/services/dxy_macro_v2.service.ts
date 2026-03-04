/**
 * DXY MACRO SERVICE v1.1
 * Applies macro adjustment to Hybrid path
 * 
 * Key: Distributes adjustment progressively over horizon (not just end point)
 */

import { MacroPack, PathPoint, HybridPack } from '../../contracts/fractal_path.contract.js';

export type MacroInput = {
  hybrid: HybridPack;
  scoreSigned: number;          // [-1..1]
  confidence: number;           // [0..1]
  dominantRegime: string;       // EASING, TIGHTENING, STRESS, NEUTRAL, etc.
  kappa?: number;               // sensitivity, default 0.05
};

/**
 * Regime-specific boost factors
 */
function getRegimeBoost(regime: string): number {
  const boosts: Record<string, number> = {
    'STRESS': 1.5,
    'TIGHTENING': 1.2,
    'EASING': 1.0,
    'PIVOT': 1.3,
    'NEUTRAL': 0.8,
    'NEUTRAL_MIXED': 0.8,
  };
  return boosts[regime] || 1.0;
}

/**
 * Build macro path with progressive adjustment
 * 
 * Formula:
 *   deltaEnd = scoreSigned × kappa × regimeBoost × confidence
 *   For each t: adjustment = deltaEnd × (t / H)
 *   macroPrice[t] = hybridPrice[t] × (1 + adjustment)
 */
export function buildMacroPackAbs(input: MacroInput): MacroPack {
  const kappa = input.kappa ?? 0.05;
  const boost = getRegimeBoost(input.dominantRegime);

  // Calculate end-horizon adjustment
  const deltaEnd = input.scoreSigned * kappa * boost * input.confidence;

  const anchor = input.hybrid.anchorPrice;
  const H = input.hybrid.path.length;

  const path: PathPoint[] = input.hybrid.path.map((p, i) => {
    // ✅ Progressive distribution: linear ramp from 0 to deltaEnd
    const alpha = H <= 1 ? 0 : i / (H - 1);
    const adjRet = deltaEnd * alpha;
    const price = p.price * (1 + adjRet);
    
    return {
      t: p.t,
      price,
      ret: price / anchor - 1,
    };
  });

  return {
    anchorPrice: anchor,
    path,
    adjustment: {
      scoreSigned: input.scoreSigned,
      confidence: input.confidence,
      regime: input.dominantRegime,
      kappa,
      deltaReturnEnd: deltaEnd,
    },
  };
}

/**
 * Apply asymmetric band reshaping based on macro regime (v2 feature)
 * 
 * If STRESS: widen downside band
 * If EASING: widen upside band
 */
export function reshapeBands(
  bands: { p10: PathPoint[]; p50: PathPoint[]; p90: PathPoint[] },
  scoreSigned: number,
  regime: string
): { p10: PathPoint[]; p50: PathPoint[]; p90: PathPoint[] } {
  const isNegative = scoreSigned < 0 || regime === 'STRESS' || regime === 'TIGHTENING';
  
  const factor = Math.abs(scoreSigned) * 0.3; // max 30% band widening
  
  const p10 = bands.p10.map((p, i) => ({
    ...p,
    price: isNegative ? p.price * (1 - factor * (i / bands.p10.length)) : p.price,
  }));
  
  const p90 = bands.p90.map((p, i) => ({
    ...p,
    price: !isNegative ? p.price * (1 + factor * (i / bands.p90.length)) : p.price,
  }));
  
  return { p10, p50: bands.p50, p90 };
}
