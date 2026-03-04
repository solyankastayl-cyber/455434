/**
 * MACRO SCORE V3 — NORMALIZER
 * 
 * Unified normalization layer:
 * 1. Transform (delta/yoy/level/spread)
 * 2. Robust Z-Score (MAD-based)
 * 3. Squash to [-1, +1] via tanh
 * 4. Apply direction
 */

import { SeriesConfig, MacroScoreV3Config, DEFAULT_CONFIG } from './macro_score.contract.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(arr: number[], med: number): number {
  if (arr.length === 0) return 0;
  const deviations = arr.map(x => Math.abs(x - med));
  return median(deviations);
}

function clip(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round6(x: number): number {
  return Math.round(x * 1000000) / 1000000;
}

// ═══════════════════════════════════════════════════════════════
// TRANSFORM FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

/**
 * Apply transformation based on series config
 */
export function applyTransform(
  series: TimeSeriesPoint[],
  config: SeriesConfig,
  asOf: string
): number | null {
  // Filter to asOf-safe values
  const safeSeries = series.filter(p => p.date <= asOf);
  if (safeSeries.length === 0) return null;
  
  // Sort by date descending
  safeSeries.sort((a, b) => b.date.localeCompare(a.date));
  
  const current = safeSeries[0];
  
  switch (config.transform) {
    case 'level':
    case 'spread':
      return current.value;
      
    case 'delta': {
      const lookbackMonths = config.lookbackMonths || 3;
      const lookbackDate = new Date(asOf);
      lookbackDate.setMonth(lookbackDate.getMonth() - lookbackMonths);
      const lookbackStr = lookbackDate.toISOString().slice(0, 10);
      
      const past = safeSeries.find(p => p.date <= lookbackStr);
      if (!past) return null;
      
      return current.value - past.value;
    }
      
    case 'yoy': {
      const yoyDate = new Date(asOf);
      yoyDate.setFullYear(yoyDate.getFullYear() - 1);
      const yoyStr = yoyDate.toISOString().slice(0, 10);
      
      const past = safeSeries.find(p => p.date <= yoyStr);
      if (!past || past.value === 0) return null;
      
      return (current.value - past.value) / past.value;
    }
      
    default:
      return current.value;
  }
}

// ═══════════════════════════════════════════════════════════════
// ROBUST Z-SCORE
// ═══════════════════════════════════════════════════════════════

export interface ZScoreResult {
  z: number;
  median: number;
  mad: number;
  clipped: boolean;
}

/**
 * Compute robust z-score using MAD
 */
export function computeRobustZScore(
  value: number,
  history: number[],
  cfg: MacroScoreV3Config = DEFAULT_CONFIG
): ZScoreResult {
  const med = median(history);
  const madVal = mad(history, med);
  
  // Scale MAD to be consistent with std for normal distribution
  const scaledMad = madVal * cfg.madScaleFactor + cfg.epsilon;
  
  const zRaw = (value - med) / scaledMad;
  const z = clip(zRaw, -cfg.zMax, cfg.zMax);
  
  return {
    z: round6(z),
    median: round6(med),
    mad: round6(madVal),
    clipped: Math.abs(zRaw) > cfg.zMax,
  };
}

// ═══════════════════════════════════════════════════════════════
// SQUASH TO [-1, +1]
// ═══════════════════════════════════════════════════════════════

/**
 * Squash z-score to [-1, +1] using tanh
 */
export function squash(z: number, k: number = 2.0): number {
  return round6(Math.tanh(z / k));
}

// ═══════════════════════════════════════════════════════════════
// FULL NORMALIZATION PIPELINE
// ═══════════════════════════════════════════════════════════════

export interface NormalizationResult {
  key: string;
  rawValue: number | null;
  z: number;
  signal: number;
  direction: number;
  clipped: boolean;
  missing: boolean;
}

/**
 * Full normalization pipeline for a single series
 */
export function normalizeSeries(
  key: string,
  series: TimeSeriesPoint[],
  config: SeriesConfig,
  asOf: string,
  cfg: MacroScoreV3Config = DEFAULT_CONFIG
): NormalizationResult {
  // Apply transform
  const rawValue = applyTransform(series, config, asOf);
  
  if (rawValue === null || !Number.isFinite(rawValue)) {
    return {
      key,
      rawValue: null,
      z: 0,
      signal: 0,
      direction: config.direction,
      clipped: false,
      missing: true,
    };
  }
  
  // Build history for z-score
  const windowStart = new Date(asOf);
  windowStart.setDate(windowStart.getDate() - cfg.windowDays);
  const windowStartStr = windowStart.toISOString().slice(0, 10);
  
  const historySeries = series.filter(p => p.date >= windowStartStr && p.date <= asOf);
  const historyValues: number[] = [];
  
  // Apply same transform to history
  for (const point of historySeries) {
    const histVal = applyTransform(
      series.filter(p => p.date <= point.date),
      config,
      point.date
    );
    if (histVal !== null && Number.isFinite(histVal)) {
      historyValues.push(histVal);
    }
  }
  
  // If not enough history, use simple scaling
  if (historyValues.length < 10) {
    const signal = clip(rawValue / (Math.abs(rawValue) + 1), -1, 1) * config.direction;
    return {
      key,
      rawValue,
      z: 0,
      signal: round6(signal),
      direction: config.direction,
      clipped: false,
      missing: false,
    };
  }
  
  // Compute z-score
  const zResult = computeRobustZScore(rawValue, historyValues, cfg);
  
  // Squash to [-1, +1]
  const squashed = squash(zResult.z, cfg.tanhK);
  
  // Apply direction
  const signal = squashed * config.direction;
  
  return {
    key,
    rawValue,
    z: zResult.z,
    signal: round6(signal),
    direction: config.direction,
    clipped: zResult.clipped,
    missing: false,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  applyTransform,
  computeRobustZScore,
  squash,
  normalizeSeries,
};
