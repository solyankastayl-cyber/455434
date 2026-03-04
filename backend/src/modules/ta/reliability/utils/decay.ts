/**
 * Phase R9: Decay Utilities
 * Time-based signal depreciation
 */

/**
 * Exponential decay with half-life
 * Returns weight in [0, 1] where 1 = fresh, 0.5 = at halfLife
 */
export function expDecay(
  ageDays: number,
  halfLifeDays = 14
): number {
  return Math.pow(0.5, ageDays / Math.max(1e-9, halfLifeDays));
}

/**
 * Linear decay (simpler alternative)
 */
export function linearDecay(
  ageDays: number,
  maxAgeDays = 30
): number {
  return Math.max(0, 1 - ageDays / maxAgeDays);
}

/**
 * Step decay (hard cutoff after threshold)
 */
export function stepDecay(
  ageDays: number,
  thresholdDays = 7,
  afterWeight = 0.5
): number {
  return ageDays <= thresholdDays ? 1.0 : afterWeight;
}

/**
 * Calculate age in days from timestamps
 */
export function ageInDays(ts: number, now: number = Date.now()): number {
  return (now - ts) / (1000 * 60 * 60 * 24);
}
