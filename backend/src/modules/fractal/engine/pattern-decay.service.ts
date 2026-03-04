/**
 * BLOCK 38.2 — Pattern Decay Service
 * 
 * Applies multi-factor decay to match weights:
 * - Age decay (already exists)
 * - Health decay (reliability-based)
 * - Stability decay (PSS-based)
 * - Similarity decay (soft floor)
 * 
 * Final weight = age × health × stability × similarity
 */

import {
  PatternDecayConfig,
  MatchWeightBreakdown,
  WeightedMatch,
  DEFAULT_PATTERN_DECAY_CONFIG,
} from '../contracts/pattern-decay.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function lerp01(x: number, good: number, bad: number): number {
  if (good === bad) return 0;
  const t = (x - bad) / (good - bad);
  return clamp01(t);
}

// ═══════════════════════════════════════════════════════════════
// Weight Components
// ═══════════════════════════════════════════════════════════════

/**
 * Health weight from reliability score
 * Maps reliability [0,1] to weight [min,max]
 */
export function healthWeight(reliability: number, cfg: PatternDecayConfig): number {
  const r = clamp01(reliability);
  const shaped = cfg.health.power === 1 ? r : Math.pow(r, cfg.health.power);
  return cfg.health.min + (cfg.health.max - cfg.health.min) * shaped;
}

/**
 * Stability weight from match stability score
 * Maps stabilityScore [0,1] to weight [minWeight,1]
 */
export function stabilityWeight(
  stabilityScore: number | undefined,
  cfg: PatternDecayConfig
): number {
  if (!cfg.stability.enabled) return 1.0;
  if (typeof stabilityScore !== 'number') return 0.70; // neutral if missing
  
  const s = clamp01(stabilityScore);
  const t = lerp01(s, cfg.stability.good, cfg.stability.bad);
  return cfg.stability.minWeight + (1 - cfg.stability.minWeight) * t;
}

/**
 * Similarity weight (soft floor)
 * Downweights matches just above the hard floor
 */
export function similarityWeight(
  similarity: number | undefined,
  cfg: PatternDecayConfig
): number {
  if (!cfg.similarity.enabled) return 1.0;
  if (typeof similarity !== 'number') return 1.0;
  
  const sim = clamp01(similarity);
  
  // Above knee = full weight
  if (sim >= cfg.similarity.knee) return 1.0;
  
  // Below knee = smooth decay
  const t = clamp01(sim / cfg.similarity.knee);
  const shaped = Math.pow(t, cfg.similarity.power);
  return cfg.similarity.minWeight + (1 - cfg.similarity.minWeight) * shaped;
}

// ═══════════════════════════════════════════════════════════════
// Main Decay Application
// ═══════════════════════════════════════════════════════════════

interface DecayableMatch {
  ageWeight?: number;
  similarity?: number;
  stabilityScore?: number;
  [key: string]: any;
}

/**
 * Apply pattern decay to matches
 * 
 * @param matches - Matches with age weights already applied
 * @param reliability - Current reliability score [0,1]
 * @param cfg - Decay configuration
 */
export function applyPatternDecay<TMatch extends DecayableMatch>(
  matches: TMatch[],
  reliability: number,
  cfg: PatternDecayConfig = DEFAULT_PATTERN_DECAY_CONFIG
): Array<WeightedMatch<TMatch>> {
  if (!cfg.enabled) {
    return matches.map(m => ({
      match: m,
      weight: {
        age: m.ageWeight ?? 1,
        health: 1,
        stability: 1,
        similarity: 1,
        final: m.ageWeight ?? 1,
      },
    }));
  }

  const wHealth = healthWeight(reliability, cfg);

  return matches.map(m => {
    const wAge = m.ageWeight ?? 1.0;
    const wSt = stabilityWeight(m.stabilityScore, cfg);
    const wSim = similarityWeight(m.similarity, cfg);
    const wFinal = wAge * wHealth * wSt * wSim;

    const breakdown: MatchWeightBreakdown = {
      age: Math.round(wAge * 1000) / 1000,
      health: Math.round(wHealth * 1000) / 1000,
      stability: Math.round(wSt * 1000) / 1000,
      similarity: Math.round(wSim * 1000) / 1000,
      final: Math.round(wFinal * 1000) / 1000,
    };

    return { match: m, weight: breakdown };
  });
}

// ═══════════════════════════════════════════════════════════════
// Weighted Statistics
// ═══════════════════════════════════════════════════════════════

/**
 * Weighted mean of values
 */
export function weightedMean(values: number[], weights: number[]): number {
  let sw = 0, s = 0;
  const n = Math.min(values.length, weights.length);
  for (let i = 0; i < n; i++) {
    sw += weights[i];
    s += weights[i] * values[i];
  }
  return sw > 0 ? s / sw : 0;
}

/**
 * Weighted standard deviation
 */
export function weightedStd(values: number[], weights: number[]): number {
  const m = weightedMean(values, weights);
  let sw = 0, s = 0;
  const n = Math.min(values.length, weights.length);
  for (let i = 0; i < n; i++) {
    sw += weights[i];
    s += weights[i] * (values[i] - m) * (values[i] - m);
  }
  return sw > 0 ? Math.sqrt(s / sw) : 0;
}

/**
 * Effective sample size (Kish's formula)
 * Accounts for weight concentration
 */
export function effectiveN(weights: number[]): number {
  const s1 = weights.reduce((a, b) => a + b, 0);
  const s2 = weights.reduce((a, b) => a + b * b, 0);
  return s2 > 0 ? (s1 * s1) / s2 : 0;
}

// ═══════════════════════════════════════════════════════════════
// Confidence Calibration
// ═══════════════════════════════════════════════════════════════

export interface ConfidenceCalibrationConfig {
  nScale: number;           // 10 (effectiveN at which conf_n ≈ 0.63)
  reliabilityWeight: number; // 0.5 (how much reliability affects confidence)
  minConfidence: number;    // 0.05
  maxConfidence: number;    // 0.95
}

export const DEFAULT_CONFIDENCE_CALIBRATION_CONFIG: ConfidenceCalibrationConfig = {
  nScale: 10,
  reliabilityWeight: 0.5,
  minConfidence: 0.05,
  maxConfidence: 0.95,
};

/**
 * Calibrate confidence based on effective sample size and reliability
 * 
 * confN = 1 - exp(-effectiveN / nScale)
 * confFinal = confN * (1 - reliabilityWeight + reliabilityWeight * reliability)
 */
export function calibrateConfidence(
  effectiveN: number,
  reliability: number,
  baseConfidence?: number,
  cfg: ConfidenceCalibrationConfig = DEFAULT_CONFIDENCE_CALIBRATION_CONFIG
): number {
  // Sample size component
  const confN = 1 - Math.exp(-effectiveN / cfg.nScale);
  
  // Reliability modifier
  const relMod = 1 - cfg.reliabilityWeight + cfg.reliabilityWeight * clamp01(reliability);
  
  // Combine with base confidence if provided
  let conf = confN * relMod;
  if (typeof baseConfidence === 'number') {
    conf = conf * baseConfidence;
  }
  
  return clamp01(Math.max(cfg.minConfidence, Math.min(cfg.maxConfidence, conf)));
}

// ═══════════════════════════════════════════════════════════════
// Summary Stats for Weighted Matches
// ═══════════════════════════════════════════════════════════════

export interface WeightedMatchStats {
  effectiveN: number;
  weightedMu: number;
  weightedExcess: number;
  weightedStd: number;
  totalWeight: number;
  avgWeight: number;
  confidenceRaw: number;
  confidenceFinal: number;
}

/**
 * Compute summary statistics for weighted matches
 */
export function computeWeightedStats<TMatch extends { mu?: number; excess?: number }>(
  weighted: Array<WeightedMatch<TMatch>>,
  reliability: number,
  baseConfidence = 0.5
): WeightedMatchStats {
  if (weighted.length === 0) {
    return {
      effectiveN: 0,
      weightedMu: 0,
      weightedExcess: 0,
      weightedStd: 0,
      totalWeight: 0,
      avgWeight: 0,
      confidenceRaw: 0,
      confidenceFinal: 0,
    };
  }

  const weights = weighted.map(w => w.weight.final);
  const mus = weighted.map(w => w.match.mu ?? 0);
  const excesses = weighted.map(w => w.match.excess ?? 0);

  const effN = effectiveN(weights);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const avgWeight = totalWeight / weights.length;

  const wMu = weightedMean(mus, weights);
  const wExcess = weightedMean(excesses, weights);
  const wStd = weightedStd(mus, weights);

  const confRaw = baseConfidence;
  const confFinal = calibrateConfidence(effN, reliability, baseConfidence);

  return {
    effectiveN: Math.round(effN * 100) / 100,
    weightedMu: Math.round(wMu * 10000) / 10000,
    weightedExcess: Math.round(wExcess * 10000) / 10000,
    weightedStd: Math.round(wStd * 10000) / 10000,
    totalWeight: Math.round(totalWeight * 1000) / 1000,
    avgWeight: Math.round(avgWeight * 1000) / 1000,
    confidenceRaw: Math.round(confRaw * 1000) / 1000,
    confidenceFinal: Math.round(confFinal * 1000) / 1000,
  };
}
