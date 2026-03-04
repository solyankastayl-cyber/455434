/**
 * Phase G: RR Calculator
 */

function clamp(x: number, min = 0, max = 999): number {
  return Math.max(min, Math.min(max, x));
}

export function rr(entry: number, stop: number, target: number, side: 'LONG' | 'SHORT'): number {
  const risk = side === 'LONG' ? (entry - stop) : (stop - entry);
  const reward = side === 'LONG' ? (target - entry) : (entry - target);
  if (risk <= 0 || reward <= 0) return 0;
  return clamp(reward / risk, 0, 50);
}
