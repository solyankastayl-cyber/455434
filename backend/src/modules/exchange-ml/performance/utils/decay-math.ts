/**
 * Exchange Horizon Bias — Time Decay Math Utilities
 * 
 * Pure functions for decay calculations.
 * No side effects, no database access.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface OutcomeDoc {
  resolvedAt: Date;
  actualOutcome: 'WIN' | 'LOSS';
  pnlPct?: number; // optional: signed return
}

// ═══════════════════════════════════════════════════════════════
// BASIC MATH
// ═══════════════════════════════════════════════════════════════

export function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Days between two dates.
 */
export function daysBetween(now: Date, past: Date): number {
  const ms = now.getTime() - past.getTime();
  return ms / (1000 * 60 * 60 * 24);
}

// ═══════════════════════════════════════════════════════════════
// DECAY WEIGHTS
// ═══════════════════════════════════════════════════════════════

/**
 * Exponential decay weight by age in days.
 * 
 * w = exp(-ageDays / tau)
 * 
 * @param ageDays - Age of the outcome in days
 * @param tauDays - Decay time constant (half-life ~= 0.693 * tau)
 */
export function decayWeight(ageDays: number, tauDays: number): number {
  return Math.exp(-ageDays / Math.max(1e-9, tauDays));
}

/**
 * Calculate decay weights for a list of outcomes.
 */
export function calculateDecayWeights(
  outcomes: OutcomeDoc[],
  now: Date,
  tauDays: number
): number[] {
  return outcomes.map(o => decayWeight(daysBetween(now, o.resolvedAt), tauDays));
}

// ═══════════════════════════════════════════════════════════════
// EFFECTIVE SAMPLE SIZE (ESS)
// ═══════════════════════════════════════════════════════════════

/**
 * Effective Sample Size (ESS) / Effective Sample Count.
 * 
 * ESS = (Σw)² / Σw²
 * 
 * This is the standard measure of "effective" samples when using weights.
 * Protects against "1 fresh outcome weighing like 100 old ones".
 * 
 * @param weights - Array of decay weights
 * @returns Effective sample count
 */
export function effectiveSampleCount(weights: number[]): number {
  if (!weights.length) return 0;
  
  const sumW = weights.reduce((a, b) => a + b, 0);
  const sumW2 = weights.reduce((a, b) => a + b * b, 0);
  
  if (sumW2 <= 0) return 0;
  
  return (sumW * sumW) / sumW2;
}

// ═══════════════════════════════════════════════════════════════
// WEIGHTED STATISTICS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate weighted win rate.
 */
export function calcWeightedWinRate(
  outcomes: OutcomeDoc[],
  weights: number[]
): number {
  if (!outcomes.length || outcomes.length !== weights.length) return 0;
  
  let winW = 0;
  let totalW = 0;
  
  for (let i = 0; i < outcomes.length; i++) {
    const w = weights[i];
    totalW += w;
    if (outcomes[i].actualOutcome === 'WIN') {
      winW += w;
    }
  }
  
  return totalW > 0 ? winW / totalW : 0;
}

/**
 * Calculate bias score from win rate.
 * 
 * bias = (winRate - 0.5) * 2
 * Range: [-1, +1]
 * 
 * - 0.5 win rate → 0 bias (neutral)
 * - 1.0 win rate → +1 bias (very bullish)
 * - 0.0 win rate → -1 bias (very bearish)
 */
export function calcBiasFromWinRate(winRate: number): number {
  return clamp(-1, 1, (winRate - 0.5) * 2);
}

/**
 * Calculate weighted stability score.
 * 
 * Stability = 1 - weighted_stddev
 * Range: [0, 1] where 1 = perfectly stable
 */
export function calcWeightedStability(
  outcomes: OutcomeDoc[],
  weights: number[]
): number {
  if (outcomes.length < 2) return 1;
  
  // Convert to binary: WIN = 1, LOSS = 0
  const values = outcomes.map(o => o.actualOutcome === 'WIN' ? 1 : 0);
  
  // Weighted mean
  let sumW = 0;
  let sumWV = 0;
  for (let i = 0; i < values.length; i++) {
    sumW += weights[i];
    sumWV += weights[i] * values[i];
  }
  const mean = sumW > 0 ? sumWV / sumW : 0;
  
  // Weighted variance
  let sumWVar = 0;
  for (let i = 0; i < values.length; i++) {
    sumWVar += weights[i] * Math.pow(values[i] - mean, 2);
  }
  const variance = sumW > 0 ? sumWVar / sumW : 0;
  const stdDev = Math.sqrt(variance);
  
  // Stability: 1 - stdDev (stdDev for binary is max ~0.5)
  return clamp(0, 1, 1 - stdDev * 2);
}

console.log('[Exchange ML] Decay math utilities loaded');
