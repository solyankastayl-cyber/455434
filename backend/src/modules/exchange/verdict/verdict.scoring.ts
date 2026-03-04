/**
 * B4 — Verdict Scoring
 * 
 * Core scoring functions for BULL/BEAR scores.
 */

import { AxisContrib, Strength } from './verdict.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function clamp11(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

/**
 * Convert -1..+1 axis to 0..1 "support for bullish"
 */
function pos01(x: number): number {
  return clamp01((clamp11(x) + 1) / 2);
}

/**
 * Convert -1..+1 axis to 0..1 "support for bearish" (inverted)
 */
function neg01(x: number): number {
  return clamp01((1 - clamp11(x)) / 2);
}

// ═══════════════════════════════════════════════════════════════
// WEIGHTS (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

const WEIGHTS = {
  momentum: 0.18,
  structure: 0.14,
  participation: 0.14,
  orderbookPressure: 0.16,
  positioning: 0.12,
  marketStress: 0.26, // stress is big, penalizes bullish
} as const;

// ═══════════════════════════════════════════════════════════════
// COMPUTE BULL/BEAR SCORES
// ═══════════════════════════════════════════════════════════════

export function computeBullBearScores(axes: AxisContrib): {
  bullScore: number;
  bearScore: number;
  delta: number;
} {
  const w = WEIGHTS;
  
  // Bullish score: positive momentum, structure, participation, pressure, low stress
  const bullish =
    w.momentum * pos01(axes.momentum) +
    w.structure * pos01(axes.structure) +
    w.participation * clamp01(axes.participation) +
    w.orderbookPressure * pos01(axes.orderbookPressure) +
    w.positioning * (1 - clamp01(axes.positioning)) + // Low crowding is bullish
    w.marketStress * (1 - clamp01(axes.marketStress)); // Low stress is bullish
  
  // Bearish score: negative momentum, structure, weak participation, high stress
  const bearish =
    w.momentum * neg01(axes.momentum) +
    w.structure * neg01(axes.structure) +
    w.participation * (1 - clamp01(axes.participation)) +
    w.orderbookPressure * neg01(axes.orderbookPressure) +
    w.positioning * clamp01(axes.positioning) + // High crowding is bearish
    w.marketStress * clamp01(axes.marketStress); // High stress is bearish
  
  const bullScore = clamp01(bullish);
  const bearScore = clamp01(bearish);
  const delta = clamp11(bullScore - bearScore);
  
  return { bullScore, bearScore, delta };
}

// ═══════════════════════════════════════════════════════════════
// STRENGTH
// ═══════════════════════════════════════════════════════════════

export function strengthFromConfidence(conf: number): Strength {
  if (conf < 0.45) return 'WEAK';
  if (conf <= 0.7) return 'MEDIUM';
  return 'STRONG';
}

console.log('[B4] Verdict Scoring loaded');
