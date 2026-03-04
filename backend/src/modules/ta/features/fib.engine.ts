/**
 * Fibonacci Engine — Retracement & Extension Feature Pack
 * 
 * Phase 7: Feature Pack
 * 
 * Computes:
 * - Major swing detection from pivots
 * - Fibonacci retracement levels (0.236, 0.382, 0.5, 0.618, 0.786)
 * - Golden pocket zone (0.618 - 0.65)
 * - Extension levels (1.272, 1.618, 2.618)
 * - Distance to nearest fib level
 */

import { TAContext, FibPack, FibSwing, FibRetrace, FibExtension, Pivot } from '../domain/types.js';

// Fibonacci ratios
const FIB_RATIOS = {
  r236: 0.236,
  r382: 0.382,
  r50: 0.5,
  r618: 0.618,
  r786: 0.786,
  goldenPocketLow: 0.618,
  goldenPocketHigh: 0.65,
  e1272: 1.272,
  e1618: 1.618,
  e2618: 2.618,
};

/**
 * Build Fibonacci Pack from TAContext
 */
export function buildFibPack(ctx: TAContext): FibPack {
  const { series, pivots, atr } = ctx;
  const candles = series.candles;
  const n = candles.length;
  
  if (n === 0 || pivots.length < 2) {
    return createEmptyFibPack();
  }

  const lastIdx = n - 1;
  const currentPrice = candles[lastIdx].close;
  const currentATR = atr[lastIdx] ?? 0;

  // Find major swing
  const swing = findMajorSwing(pivots, currentATR);
  
  if (!swing) {
    return createEmptyFibPack();
  }

  // Calculate retracement levels
  const retrace = calculateRetracement(swing, currentPrice);
  
  // Calculate extension levels
  const ext = calculateExtension(swing);

  // Calculate distance to nearest fib level
  const distToNearestLevel = calculateNearestFibDistance(retrace, ext, currentPrice);

  return {
    swing,
    retrace,
    ext,
    distToNearestLevel,
  };
}

/**
 * Find the most significant swing from recent pivots
 * Uses amplitude relative to ATR to determine significance
 */
function findMajorSwing(pivots: Pivot[], atr: number, lookback = 12): FibSwing | null {
  if (pivots.length < 2) return null;

  // Get recent pivots
  const recent = pivots.slice(-lookback);
  if (recent.length < 2) return null;

  let bestSwing: FibSwing | null = null;
  let bestScore = 0;

  // Look for significant swings
  for (let i = 0; i < recent.length - 1; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const p1 = recent[i];
      const p2 = recent[j];
      
      // Skip if same type (need HIGH-LOW or LOW-HIGH)
      if (p1.type === p2.type) continue;
      
      const amplitude = Math.abs(p2.price - p1.price);
      const atrRatio = atr > 0 ? amplitude / atr : 1;
      
      // Score: amplitude/ATR * recency bonus
      const recencyBonus = 1 + (j / recent.length) * 0.5;
      const score = atrRatio * recencyBonus;
      
      if (score > bestScore && atrRatio > 2) {
        bestScore = score;
        const dir = p2.price > p1.price ? "UP" : "DOWN";
        
        bestSwing = {
          fromIdx: p1.i,
          toIdx: p2.i,
          fromPrice: p1.price,
          toPrice: p2.price,
          dir,
          amplitude,
        };
      }
    }
  }

  // If no swing found, use last two pivots
  if (!bestSwing && recent.length >= 2) {
    const p1 = recent[recent.length - 2];
    const p2 = recent[recent.length - 1];
    
    if (p1.type !== p2.type) {
      const dir = p2.price > p1.price ? "UP" : "DOWN";
      bestSwing = {
        fromIdx: p1.i,
        toIdx: p2.i,
        fromPrice: p1.price,
        toPrice: p2.price,
        dir,
        amplitude: Math.abs(p2.price - p1.price),
      };
    }
  }

  return bestSwing;
}

/**
 * Calculate Fibonacci retracement levels
 */
function calculateRetracement(swing: FibSwing, currentPrice: number): FibRetrace {
  const { fromPrice, toPrice, dir } = swing;
  const range = Math.abs(toPrice - fromPrice);
  
  // Retracement from the end of the swing
  // If UP swing: retrace down from top
  // If DOWN swing: retrace up from bottom
  const calcLevel = (ratio: number): number => {
    if (dir === "UP") {
      return toPrice - range * ratio;
    } else {
      return toPrice + range * ratio;
    }
  };

  const levels = {
    r236: calcLevel(FIB_RATIOS.r236),
    r382: calcLevel(FIB_RATIOS.r382),
    r50: calcLevel(FIB_RATIOS.r50),
    r618: calcLevel(FIB_RATIOS.r618),
    r786: calcLevel(FIB_RATIOS.r786),
    goldenPocketLow: calcLevel(FIB_RATIOS.goldenPocketLow),
    goldenPocketHigh: calcLevel(FIB_RATIOS.goldenPocketHigh),
  };

  // Check if price is in golden pocket
  const gpLow = Math.min(levels.goldenPocketLow, levels.goldenPocketHigh);
  const gpHigh = Math.max(levels.goldenPocketLow, levels.goldenPocketHigh);
  const priceInGoldenPocket = currentPrice >= gpLow && currentPrice <= gpHigh;

  // Find nearest level
  const allLevels = [levels.r236, levels.r382, levels.r50, levels.r618, levels.r786];
  const allRatios = [0.236, 0.382, 0.5, 0.618, 0.786];
  
  let nearestLevel = levels.r618;
  let nearestRatio = 0.618;
  let minDist = Infinity;
  
  for (let i = 0; i < allLevels.length; i++) {
    const dist = Math.abs(currentPrice - allLevels[i]);
    if (dist < minDist) {
      minDist = dist;
      nearestLevel = allLevels[i];
      nearestRatio = allRatios[i];
    }
  }

  return {
    ...levels,
    priceInGoldenPocket,
    nearestLevel,
    nearestRatio,
  };
}

/**
 * Calculate Fibonacci extension levels
 */
function calculateExtension(swing: FibSwing): FibExtension {
  const { fromPrice, toPrice, dir } = swing;
  const range = Math.abs(toPrice - fromPrice);
  
  // Extensions project beyond the swing
  const calcExt = (ratio: number): number => {
    if (dir === "UP") {
      return toPrice + range * (ratio - 1);
    } else {
      return toPrice - range * (ratio - 1);
    }
  };

  return {
    e1272: calcExt(FIB_RATIOS.e1272),
    e1618: calcExt(FIB_RATIOS.e1618),
    e2618: calcExt(FIB_RATIOS.e2618),
  };
}

/**
 * Calculate distance to nearest Fibonacci level
 */
function calculateNearestFibDistance(
  retrace: FibRetrace | null,
  ext: FibExtension | null,
  currentPrice: number
): number {
  if (!retrace || !ext || currentPrice === 0) return 1;

  const allLevels = [
    retrace.r236,
    retrace.r382,
    retrace.r50,
    retrace.r618,
    retrace.r786,
    ext.e1272,
    ext.e1618,
  ];

  let minDist = Infinity;
  for (const level of allLevels) {
    const dist = Math.abs(currentPrice - level) / currentPrice;
    if (dist < minDist) {
      minDist = dist;
    }
  }

  return Math.min(minDist, 1);
}

/**
 * Create empty Fib Pack for edge cases
 */
function createEmptyFibPack(): FibPack {
  return {
    swing: null,
    retrace: null,
    ext: null,
    distToNearestLevel: 1,
  };
}

/**
 * Flatten Fib Pack to features map
 */
export function flattenFibPack(pack: FibPack): Record<string, number> {
  const features: Record<string, number> = {
    fib_hasSwing: pack.swing ? 1 : 0,
    fib_distToNearest: pack.distToNearestLevel,
  };

  if (pack.swing) {
    features.fib_swingDir = pack.swing.dir === "UP" ? 1 : -1;
    features.fib_swingAmplitude = pack.swing.amplitude;
  }

  if (pack.retrace) {
    features.fib_r382 = pack.retrace.r382;
    features.fib_r50 = pack.retrace.r50;
    features.fib_r618 = pack.retrace.r618;
    features.fib_inGoldenPocket = pack.retrace.priceInGoldenPocket ? 1 : 0;
    features.fib_nearestRatio = pack.retrace.nearestRatio;
  }

  if (pack.ext) {
    features.fib_e1272 = pack.ext.e1272;
    features.fib_e1618 = pack.ext.e1618;
  }

  return features;
}
