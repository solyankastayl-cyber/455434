/**
 * BLOCK 37.4 — PSS Utilities
 * 
 * Helper functions for Pattern Stability Score computation.
 */

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Jaccard similarity between two sets
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

/**
 * Normalize weights to sum to 1
 */
export function normalizeWeights(w: { ret: number; vol: number; dd: number }): { ret: number; vol: number; dd: number } {
  const s = w.ret + w.vol + w.dd;
  if (s <= 0) return { ret: 0.5, vol: 0.3, dd: 0.2 };
  return { ret: w.ret / s, vol: w.vol / s, dd: w.dd / s };
}

/**
 * Apply jitter to weights and renormalize
 */
export function jitterWeights(
  base: { ret: number; vol: number; dd: number },
  jitter: number,
  rnd: () => number = Math.random
): { ret: number; vol: number; dd: number } {
  const j = (x: number) => x * (1 + (rnd() * 2 - 1) * jitter);
  return normalizeWeights({ ret: j(base.ret), vol: j(base.vol), dd: j(base.dd) });
}

/**
 * Mean of array
 */
export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Standard deviation of array
 */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Exponential decay score: lower std = higher score
 */
export function expScore(std: number, maxStd: number): number {
  return Math.exp(-std / maxStd);
}

/**
 * Linear interpolation score: good -> 1, bad -> 0
 */
export function lerp01(x: number, good: number, bad: number): number {
  if (good === bad) return 0;
  const t = (x - bad) / (good - bad);
  return clamp01(t);
}

/**
 * Weighted mean of values
 */
export function weightedMean(parts: Array<{ w: number; v: number }>): number {
  const sw = parts.reduce((s, p) => s + p.w, 0);
  if (sw <= 0) return 0;
  return parts.reduce((s, p) => s + p.w * p.v, 0) / sw;
}

/**
 * Effective sample size (accounts for weight concentration)
 * Kish's formula: (sum(w))^2 / sum(w^2)
 */
export function effectiveN(ws: number[]): number {
  const s1 = ws.reduce((a, b) => a + b, 0);
  const s2 = ws.reduce((a, b) => a + b * b, 0);
  return s2 > 0 ? (s1 * s1) / s2 : 0;
}
