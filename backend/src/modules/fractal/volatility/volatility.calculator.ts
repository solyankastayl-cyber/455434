/**
 * P1.4 — Volatility Features Calculator
 * 
 * Computes: RV30, RV90, ATR14, percentiles, z-scores
 * Pure math — no decisions.
 */

import type { DailyCandle, VolatilityFeatures } from './volatility.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}

function percentileRank(arr: number[], value: number): number {
  if (arr.length === 0) return 0.5;
  const below = arr.filter(x => x < value).length;
  return below / arr.length;
}

// ═══════════════════════════════════════════════════════════════
// LOG RETURNS
// ═══════════════════════════════════════════════════════════════

function computeLogReturns(candles: DailyCandle[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0 && curr > 0) {
      returns.push(Math.log(curr / prev));
    }
  }
  return returns;
}

// ═══════════════════════════════════════════════════════════════
// REALIZED VOLATILITY
// ═══════════════════════════════════════════════════════════════

function computeRealizedVolatility(logReturns: number[], window: number): number {
  if (logReturns.length < window) {
    return std(logReturns) * Math.sqrt(365);
  }
  const slice = logReturns.slice(-window);
  return std(slice) * Math.sqrt(365); // Annualized
}

// Rolling RV for percentile calculation
function computeRollingRV(logReturns: number[], rvWindow: number, rollingWindow: number): number[] {
  const rvs: number[] = [];
  for (let i = rvWindow; i <= logReturns.length; i++) {
    const slice = logReturns.slice(i - rvWindow, i);
    const rv = std(slice) * Math.sqrt(365);
    rvs.push(rv);
  }
  // Take last rollingWindow values
  return rvs.slice(-rollingWindow);
}

// ═══════════════════════════════════════════════════════════════
// ATR (Average True Range)
// ═══════════════════════════════════════════════════════════════

function computeTrueRange(candles: DailyCandle[]): number[] {
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const range = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    tr.push(range);
  }
  return tr;
}

function computeATR(trueRanges: number[], period: number): number {
  if (trueRanges.length < period) {
    return mean(trueRanges);
  }
  // Simple moving average of TR
  return mean(trueRanges.slice(-period));
}

function computeRollingATR(trueRanges: number[], atrPeriod: number, rollingWindow: number): number[] {
  const atrs: number[] = [];
  for (let i = atrPeriod; i <= trueRanges.length; i++) {
    const slice = trueRanges.slice(i - atrPeriod, i);
    atrs.push(mean(slice));
  }
  return atrs.slice(-rollingWindow);
}

// ═══════════════════════════════════════════════════════════════
// MAIN CALCULATOR
// ═══════════════════════════════════════════════════════════════

export function computeVolatilityFeatures(candles: DailyCandle[]): VolatilityFeatures {
  // Need at least 100 candles for meaningful stats
  if (candles.length < 100) {
    return {
      rv30: 0,
      rv90: 0,
      rv365Mean: 0,
      rv365Std: 0,
      atr14: 0,
      atr14Pct: 0,
      atrPercentile: 0.5,
      volRatio: 1,
      volZScore: 0,
    };
  }

  const logReturns = computeLogReturns(candles);
  const trueRanges = computeTrueRange(candles);
  const currentClose = candles[candles.length - 1].close;

  // Realized Volatility
  const rv30 = computeRealizedVolatility(logReturns, 30);
  const rv90 = computeRealizedVolatility(logReturns, 90);

  // Rolling RV for percentiles and z-score
  const rollingRVs = computeRollingRV(logReturns, 30, 365);
  const rv365Mean = mean(rollingRVs);
  const rv365Std = std(rollingRVs);

  // ATR
  const atr14 = computeATR(trueRanges, 14);
  const atr14Pct = currentClose > 0 ? atr14 / currentClose : 0;

  // ATR percentile
  const rollingATRs = computeRollingATR(trueRanges, 14, 365);
  const atrPercentile = percentileRank(rollingATRs, atr14);

  // Vol ratio and z-score
  const volRatio = rv90 > 0 ? rv30 / rv90 : 1;
  const volZScore = rv365Std > 0 ? (rv30 - rv365Mean) / rv365Std : 0;

  return {
    rv30,
    rv90,
    rv365Mean,
    rv365Std,
    atr14,
    atr14Pct,
    atrPercentile,
    volRatio,
    volZScore,
  };
}

// ═══════════════════════════════════════════════════════════════
// PERCENTILE THRESHOLDS
// ═══════════════════════════════════════════════════════════════

export function computeRVPercentiles(candles: DailyCandle[]): { p25: number; p75: number; p95: number } {
  const logReturns = computeLogReturns(candles);
  const rollingRVs = computeRollingRV(logReturns, 30, 365);
  
  return {
    p25: percentile(rollingRVs, 0.25),
    p75: percentile(rollingRVs, 0.75),
    p95: percentile(rollingRVs, 0.95),
  };
}
