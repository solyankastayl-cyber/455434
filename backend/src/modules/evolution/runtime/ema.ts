/**
 * EMA UTILS
 */

export function ema(prev: number, next: number, alpha: number): number {
  if (!Number.isFinite(prev)) return next;
  return alpha * next + (1 - alpha) * prev;
}

export function alphaForHorizon(h: "1D" | "7D" | "30D"): number {
  // Faster for short horizon
  if (h === "1D") return 0.20;
  if (h === "7D") return 0.12;
  return 0.08;
}

console.log('[Evolution] EMA utils loaded');
