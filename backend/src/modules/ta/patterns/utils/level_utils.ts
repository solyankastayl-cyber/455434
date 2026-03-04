/**
 * Phase R: Level Utilities
 */

export function nearLevel(price: number, level: number, tolerance = 0.002): boolean {
  return Math.abs(price - level) / level < tolerance;
}

export function withinPct(a: number, b: number, pct: number): boolean {
  return Math.abs(a - b) / Math.max(1e-9, b) <= pct;
}

export function withinRange(v: number, [min, max]: number[]): boolean {
  return v >= min * 0.9 && v <= max * 1.1;
}
