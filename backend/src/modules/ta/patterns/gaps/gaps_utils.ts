/**
 * Phase R10.A: Gap Utilities
 */

export interface Candle {
  t?: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

/**
 * Check if there's a gap up between two candles
 */
export function hasGapUp(prev: Candle, curr: Candle): boolean {
  return curr.l > prev.h;
}

/**
 * Check if there's a gap down between two candles
 */
export function hasGapDown(prev: Candle, curr: Candle): boolean {
  return curr.h < prev.l;
}

/**
 * Calculate gap size as percentage
 */
export function gapSizePct(prev: Candle, curr: Candle): number {
  const mid = (prev.c + curr.c) / 2;
  let gap = 0;
  
  if (hasGapUp(prev, curr)) {
    gap = curr.l - prev.h;
  } else if (hasGapDown(prev, curr)) {
    gap = prev.l - curr.h;
  }
  
  return gap / Math.max(1e-9, mid);
}

/**
 * Get gap boundaries
 */
export function getGapZone(prev: Candle, curr: Candle): { top: number; bottom: number } | null {
  if (hasGapUp(prev, curr)) {
    return { top: curr.l, bottom: prev.h };
  }
  if (hasGapDown(prev, curr)) {
    return { top: prev.l, bottom: curr.h };
  }
  return null;
}

/**
 * Check if a Fair Value Gap exists (3-candle imbalance)
 */
export function hasFVG(
  a: Candle,
  b: Candle,
  c: Candle
): { type: 'BULL' | 'BEAR'; gap: number } | null {
  // Bull FVG: candle A high < candle C low
  if (a.h < c.l) {
    return { type: 'BULL', gap: c.l - a.h };
  }
  
  // Bear FVG: candle A low > candle C high
  if (a.l > c.h) {
    return { type: 'BEAR', gap: a.l - c.h };
  }
  
  return null;
}
