/**
 * Rankings V2 Score Calculator
 * 
 * Core ranking formula with anti-manipulation factors
 */
import type { RankingsV2Input, RankTrace } from './rankings_v2.types.js';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp0_100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

export interface RankScoreResult {
  score: number;
  trace: RankTrace;
}

/**
 * Compute Rankings V2 Score
 * 
 * Formula:
 * rankScore = evidence × lifecycle × freshness × cluster × penalty × antiSpam
 * 
 * Each factor can reduce the score based on quality/manipulation signals
 */
export function computeRankScoreV2(input: RankingsV2Input): RankScoreResult {
  // 1. Lifecycle Factor
  // Active signals = full weight, cooldown = 50%, resolved = 10%
  const lifecycleFactor = 
    clamp01(input.lifecycleMix.active) +
    0.5 * clamp01(input.lifecycleMix.cooldown) +
    0.1 * clamp01(input.lifecycleMix.resolved);

  // 2. Freshness Factor
  // Exponential decay based on average signal age
  const lambda = 0.02; // decay rate per hour
  const freshnessFactor = input.freshnessScore ?? 
    Math.exp(-lambda * Math.max(0, input.avgSignalAgeHours));

  // 3. Cluster Quality Factor
  // Penalize poor cluster confirmation or high dominance
  let clusterFactor = 1.0;
  if (input.clusterPassRate < 0.5) {
    clusterFactor = 0.70; // Strong penalty for cluster failure
  } else if (input.avgDominance > 0.85) {
    clusterFactor = 0.75; // Strong penalty for extreme dominance
  } else if (input.avgDominance > 0.70) {
    clusterFactor = 0.85; // Moderate penalty
  }

  // 4. Penalty Factor
  // Direct reduction based on penalty rate
  const penaltyFactor = 1 - clamp01(input.penaltyRate);

  // 5. Anti-Spam Factor
  // Diminishing returns for many signals (prevents flooding attacks)
  const antiSpamFactor = 1 / Math.log2(2 + Math.max(0, input.activeSignals));

  // Base score = evidence (could blend with coverage: 0.85*evidence + 0.15*coverage)
  const baseEvidence = input.evidence;

  // Final score calculation
  const scoreRaw = 
    baseEvidence *
    lifecycleFactor *
    freshnessFactor *
    clusterFactor *
    penaltyFactor *
    antiSpamFactor;

  const score = clamp0_100(scoreRaw);

  return {
    score,
    trace: {
      baseEvidence,
      lifecycleFactor: Number(lifecycleFactor.toFixed(4)),
      freshnessFactor: Number(freshnessFactor.toFixed(4)),
      clusterFactor,
      penaltyFactor: Number(penaltyFactor.toFixed(4)),
      antiSpamFactor: Number(antiSpamFactor.toFixed(4)),
      scoreRaw: Number(scoreRaw.toFixed(2)),
    },
  };
}
