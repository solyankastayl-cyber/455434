/**
 * Features Builder — Unified Feature Pack Assembly
 * 
 * Phase 7: Feature Pack
 * 
 * Single entry point for building all feature packs:
 * - MA Pack
 * - Fib Pack  
 * - Vol Pack
 * 
 * Also flattens to ctx.features for ML compatibility.
 */

import { TAContext, FeaturePack } from '../domain/types.js';
import { buildMAPack, flattenMAPack } from './ma.engine.js';
import { buildFibPack, flattenFibPack } from './fib.engine.js';
import { buildVolPack, flattenVolPack } from './vol.engine.js';

/**
 * Build complete Feature Pack from TAContext
 */
export function buildFeaturePack(ctx: TAContext): FeaturePack {
  const ma = buildMAPack(ctx);
  const fib = buildFibPack(ctx);
  const vol = buildVolPack(ctx);

  return { ma, fib, vol };
}

/**
 * Flatten Feature Pack to features map for ML
 */
export function flattenFeaturePack(pack: FeaturePack): Record<string, number> {
  return {
    ...flattenMAPack(pack.ma),
    ...flattenFibPack(pack.fib),
    ...flattenVolPack(pack.vol),
  };
}

/**
 * Apply Feature Pack to TAContext
 * Updates ctx.featuresPack and merges flat features into ctx.features
 */
export function applyFeaturePack(ctx: TAContext): TAContext {
  const featuresPack = buildFeaturePack(ctx);
  const flatFeatures = flattenFeaturePack(featuresPack);

  return {
    ...ctx,
    featuresPack,
    features: {
      ...ctx.features,
      ...flatFeatures,
    },
  };
}

/**
 * Get MA alignment bonus for scoring
 * Returns +bonus for aligned direction, -penalty for misaligned
 */
export function getMAAlignmentBonus(
  pack: FeaturePack,
  direction: "BULLISH" | "BEARISH" | "NEUTRAL"
): number {
  const { ma } = pack;
  
  if (direction === "NEUTRAL") return 0;
  
  let bonus = 0;
  
  // Alignment bonus
  if (direction === "BULLISH" && ma.alignment === "BULL") {
    bonus += 0.15;
  } else if (direction === "BEARISH" && ma.alignment === "BEAR") {
    bonus += 0.15;
  } else if (
    (direction === "BULLISH" && ma.alignment === "BEAR") ||
    (direction === "BEARISH" && ma.alignment === "BULL")
  ) {
    bonus -= 0.10; // Penalty for trading against MA alignment
  }

  // Slope bonus
  if (direction === "BULLISH" && ma.slope50 > 0 && ma.slope200 > 0) {
    bonus += 0.05;
  } else if (direction === "BEARISH" && ma.slope50 < 0 && ma.slope200 < 0) {
    bonus += 0.05;
  }

  // Position vs MAs
  if (direction === "BULLISH" && ma.dist50 > 0 && ma.dist200 > 0) {
    bonus += 0.05; // Price above both MAs
  } else if (direction === "BEARISH" && ma.dist50 < 0 && ma.dist200 < 0) {
    bonus += 0.05; // Price below both MAs
  }

  return bonus;
}

/**
 * Get Fib confluence bonus for scoring
 * Returns bonus if pattern aligns with key fib levels
 */
export function getFibConfluenceBonus(
  pack: FeaturePack,
  entryPrice: number
): number {
  const { fib } = pack;
  
  if (!fib.retrace) return 0;
  
  let bonus = 0;
  
  // Golden pocket bonus
  if (fib.retrace.priceInGoldenPocket) {
    bonus += 0.10;
  }
  
  // Near key fib level bonus (within 1%)
  if (fib.distToNearestLevel < 0.01) {
    bonus += 0.08;
  } else if (fib.distToNearestLevel < 0.02) {
    bonus += 0.04;
  }

  // Check if entry is near a retracement level
  const fibLevels = [
    fib.retrace.r382,
    fib.retrace.r50,
    fib.retrace.r618,
    fib.retrace.r786,
  ];

  for (const level of fibLevels) {
    const distPct = Math.abs(entryPrice - level) / entryPrice;
    if (distPct < 0.005) { // Within 0.5%
      bonus += 0.05;
      break;
    }
  }

  return bonus;
}

/**
 * Get Vol Gate multiplier for scoring
 * Reduces confidence in extreme volatility conditions
 */
export function getVolGate(pack: FeaturePack): number {
  return pack.vol.volGate;
}

/**
 * Combine all feature bonuses for pattern scoring
 */
export function getFeatureBonus(
  pack: FeaturePack,
  direction: "BULLISH" | "BEARISH" | "NEUTRAL",
  entryPrice: number
): { bonus: number; volGate: number; breakdown: Record<string, number> } {
  const maBonus = getMAAlignmentBonus(pack, direction);
  const fibBonus = getFibConfluenceBonus(pack, entryPrice);
  const volGate = getVolGate(pack);

  return {
    bonus: maBonus + fibBonus,
    volGate,
    breakdown: {
      maAlignment: maBonus,
      fibConfluence: fibBonus,
      volGate,
    },
  };
}
