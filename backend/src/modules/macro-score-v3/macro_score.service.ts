/**
 * MACRO SCORE V3 — SERVICE
 * 
 * Main computation service:
 * 1. Normalize all series
 * 2. Aggregate with weights
 * 3. Compute confidence, concentration, entropy
 * 4. Extract drivers
 */

import crypto from 'crypto';
import {
  SERIES_CONFIG,
  MacroScoreV3Config,
  DEFAULT_CONFIG,
  MacroScoreV3Result,
  Driver,
  Diagnostics,
  SeriesConfig,
} from './macro_score.contract.js';
import {
  normalizeSeries,
  NormalizationResult,
  TimeSeriesPoint,
} from './macro_score.normalizer.js';
import {
  getFrequencyAdjustmentFactor,
  getAllFrequencyFactors,
} from './frequency_normalization.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function round6(x: number): number {
  return Math.round(x * 1000000) / 1000000;
}

function clip(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function computeHash(data: any): string {
  const str = JSON.stringify(data);
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 8);
}

// ═══════════════════════════════════════════════════════════════
// WEIGHT ADJUSTMENTS BY HORIZON
// ═══════════════════════════════════════════════════════════════

const HORIZON_WEIGHT_ADJUSTMENTS: Record<number, Record<string, number>> = {
  30: {},
  90: { T10Y2Y: 1.04, FEDFUNDS: 0.94, M2SL: 1.10, VIXCLS: 0.80 },
  180: { T10Y2Y: 1.08, FEDFUNDS: 0.86, M2SL: 1.21, VIXCLS: 0.60 },
  365: { T10Y2Y: 1.12, FEDFUNDS: 0.79, M2SL: 1.32, VIXCLS: 0.40 },
};

function getAdjustedWeight(
  key: string,
  baseWeight: number,
  horizon: number,
  useHorizonWeights: boolean
): number {
  if (!useHorizonWeights) return baseWeight;
  
  const adjustments = HORIZON_WEIGHT_ADJUSTMENTS[horizon] || {};
  const multiplier = adjustments[key] || 1.0;
  return baseWeight * multiplier;
}

// ═══════════════════════════════════════════════════════════════
// ENTROPY CALCULATION
// ═══════════════════════════════════════════════════════════════

function computeEntropy(contributions: number[]): number {
  const absContribs = contributions.map(c => Math.abs(c));
  const total = absContribs.reduce((a, b) => a + b, 0);
  
  if (total < 1e-10) return 0;
  
  const probs = absContribs.map(c => c / total);
  const entropy = -probs.reduce((sum, p) => {
    if (p < 1e-10) return sum;
    return sum + p * Math.log(p);
  }, 0);
  
  const maxEntropy = Math.log(contributions.length);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

// ═══════════════════════════════════════════════════════════════
// CONCENTRATION CALCULATION
// ═══════════════════════════════════════════════════════════════

function computeConcentration(contributions: number[], k: number = 3): number {
  const absContribs = contributions.map(c => Math.abs(c)).sort((a, b) => b - a);
  const total = absContribs.reduce((a, b) => a + b, 0);
  
  if (total < 1e-10) return 0;
  
  const topK = absContribs.slice(0, k).reduce((a, b) => a + b, 0);
  return topK / total;
}

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE CALCULATION
// ═══════════════════════════════════════════════════════════════

function computeConfidence(
  entropyNorm: number,
  freshCount: number,
  totalCount: number,
  signals: number[]
): number {
  // Data freshness factor
  const dataFreshness = totalCount > 0 ? freshCount / totalCount : 0;
  
  // Stability factor (lower std = more stable)
  const mean = signals.reduce((a, b) => a + b, 0) / (signals.length || 1);
  const variance = signals.reduce((sum, s) => sum + (s - mean) ** 2, 0) / (signals.length || 1);
  const std = Math.sqrt(variance);
  const stability = clip(1 - std / 2, 0, 1);
  
  // Final confidence
  const conf = (1 - entropyNorm) * dataFreshness * stability;
  return clip(conf, 0, 1);
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPUTATION
// ═══════════════════════════════════════════════════════════════

export interface SeriesData {
  key: string;
  data: TimeSeriesPoint[];
}

export async function computeMacroScoreV3(
  seriesData: SeriesData[],
  asOf: string,
  asset: string = 'DXY',
  horizon: number = 90,
  cfg: MacroScoreV3Config = DEFAULT_CONFIG
): Promise<MacroScoreV3Result> {
  const startTime = Date.now();
  
  // Build series map
  const seriesMap = new Map<string, TimeSeriesPoint[]>();
  for (const s of seriesData) {
    seriesMap.set(s.key, s.data);
  }
  
  // Normalize all series
  const normalizations: NormalizationResult[] = [];
  const missingSeries: string[] = [];
  
  for (const config of SERIES_CONFIG) {
    const data = seriesMap.get(config.key) || [];
    const result = normalizeSeries(config.key, data, config, asOf, cfg);
    normalizations.push(result);
    
    if (result.missing) {
      missingSeries.push(config.key);
    }
  }
  
  // Filter to non-missing
  const validNorms = normalizations.filter(n => !n.missing);
  
  // Compute weights (adjusted by horizon and frequency)
  const weights: Record<string, number> = {};
  const frequencyFactors = getAllFrequencyFactors();
  let totalWeight = 0;
  
  for (const norm of validNorms) {
    const config = SERIES_CONFIG.find(c => c.key === norm.key)!;
    let weight = getAdjustedWeight(
      norm.key,
      config.defaultWeight,
      horizon,
      cfg.useHorizonWeights
    );
    
    // Apply frequency normalization factor
    if (cfg.useFrequencyNormalization) {
      const freqFactor = frequencyFactors[norm.key] || 1.0;
      weight *= freqFactor;
    }
    
    weights[norm.key] = weight;
    totalWeight += weight;
  }
  
  // Normalize weights
  if (totalWeight > 0) {
    for (const key of Object.keys(weights)) {
      weights[key] /= totalWeight;
    }
  }
  
  // Compute contributions and score
  const contributions: Record<string, number> = {};
  let score = 0;
  
  for (const norm of validNorms) {
    const w = weights[norm.key] || 0;
    const contribution = w * norm.signal;
    contributions[norm.key] = round6(contribution);
    score += contribution;
  }
  
  score = clip(score, -1, 1);
  
  // Compute entropy and concentration
  const contribValues = Object.values(contributions);
  const entropyNorm = computeEntropy(contribValues);
  const concentration = computeConcentration(contribValues, cfg.topKDrivers);
  
  // Compute confidence
  const freshCount = validNorms.length; // Simplified: all valid = fresh
  const signals = validNorms.map(n => n.signal);
  const confidence = computeConfidence(entropyNorm, freshCount, SERIES_CONFIG.length, signals);
  
  // Extract drivers
  const driverData = validNorms
    .map(norm => ({
      name: norm.key,
      direction: norm.direction as -1 | 1,
      contribution: contributions[norm.key] || 0,
      z: norm.z,
      signal: norm.signal,
      weight: weights[norm.key] || 0,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, cfg.topKDrivers);
  
  // Build diagnostics
  const zScores: Record<string, number> = {};
  const signalsMap: Record<string, number> = {};
  
  for (const norm of normalizations) {
    zScores[norm.key] = norm.z;
    signalsMap[norm.key] = norm.signal;
  }
  
  const windowStart = new Date(asOf);
  windowStart.setDate(windowStart.getDate() - cfg.windowDays);
  
  const inputsHash = computeHash({
    asOf,
    asset,
    horizon,
    seriesKeys: seriesData.map(s => s.key).sort(),
  });
  
  const diagnostics: Diagnostics = {
    inputsHash,
    seriesCount: validNorms.length,
    missingSeries,
    freshCount,
    zScores,
    signals: signalsMap,
    contributions,
    windowMeta: {
      start: windowStart.toISOString().slice(0, 10),
      end: asOf,
      days: cfg.windowDays,
    },
  };
  
  return {
    ok: true,
    version: 'v3.0.0',
    asOf,
    asset,
    horizon,
    score: round4(score),
    confidence: round4(confidence),
    concentration: round4(concentration),
    entropy: round4(entropyNorm),
    drivers: driverData,
    diagnostics,
    computedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY INTEGRATION
// ═══════════════════════════════════════════════════════════════

export interface OverlayResult {
  baseReturn: number;
  adjustedReturn: number;
  macroImpact: number;
  bounded: boolean;
}

export function applyMacroOverlay(
  baseReturn: number,
  macroScore: number,
  cfg: MacroScoreV3Config = DEFAULT_CONFIG
): OverlayResult {
  const impact = cfg.macroStrength * macroScore * cfg.impactCap;
  const maxImpact = cfg.impactCap * Math.abs(baseReturn);
  
  const boundedImpact = clip(impact, -maxImpact, maxImpact);
  const adjustedReturn = baseReturn + boundedImpact;
  
  return {
    baseReturn,
    adjustedReturn: round6(adjustedReturn),
    macroImpact: round6(boundedImpact),
    bounded: Math.abs(impact) > maxImpact,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  computeMacroScoreV3,
  applyMacroOverlay,
};
