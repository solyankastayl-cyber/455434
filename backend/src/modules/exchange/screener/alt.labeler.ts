/**
 * BLOCK 1.4.3 — Alt Labeler
 * ==========================
 * Labels vectors based on future returns (for training).
 */

import type { AltFeatureVector } from './contracts/alt.feature.vector.js';

// Thresholds for labeling
const WINNER_THRESHOLD = 0.10;   // 10% return = WINNER
const LOSER_THRESHOLD = -0.05;   // -5% return = LOSER

export type OutcomeLabel = 'WINNER' | 'LOSER' | 'NEUTRAL';

/**
 * Label a vector based on future return
 */
export function labelByReturn(
  vector: AltFeatureVector,
  futureReturn: number
): AltFeatureVector {
  let label: OutcomeLabel;

  if (futureReturn >= WINNER_THRESHOLD) {
    label = 'WINNER';
  } else if (futureReturn <= LOSER_THRESHOLD) {
    label = 'LOSER';
  } else {
    label = 'NEUTRAL';
  }

  return {
    ...vector,
    futureReturn,
    label,
  };
}

/**
 * Label batch of vectors with outcomes
 */
export function labelBatch(
  vectors: AltFeatureVector[],
  outcomes: Map<string, number> // symbol -> return
): AltFeatureVector[] {
  return vectors.map(v => {
    const ret = outcomes.get(v.symbol) ?? 0;
    return labelByReturn(v, ret);
  });
}

/**
 * Calculate win rate from labeled samples
 */
export function calculateWinRate(samples: AltFeatureVector[]): number {
  const winners = samples.filter(s => s.label === 'WINNER').length;
  return samples.length > 0 ? winners / samples.length : 0;
}

console.log('[Screener] Alt Labeler loaded');
