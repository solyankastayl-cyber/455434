/**
 * TA Indicators — Core technical indicators
 * 
 * ATR, MA, Slope, Returns, etc.
 * Production-ready implementations.
 */

import { Candle } from '../domain/types.js';

/**
 * Compute log price series
 */
export function computeLogPrice(candles: Candle[]): number[] {
  return candles.map(c => Math.log(c.close));
}

/**
 * Compute daily returns
 */
export function computeReturns(candles: Candle[]): number[] {
  const r: number[] = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const cur = candles[i].close;
    r[i] = prev > 0 ? (cur / prev - 1) : 0;
  }
  return r;
}

/**
 * ATR (Wilder's smoothing)
 * @param candles - OHLC candles
 * @param period - ATR period (default: 14)
 */
export function computeATR(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const tr: number[] = new Array(n).fill(0);
  
  // Calculate True Range
  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  const atr: number[] = new Array(n).fill(0);
  
  // Seed ATR
  let sum = 0;
  for (let i = 1; i < Math.min(n, period + 1); i++) sum += tr[i];
  const seedIdx = Math.min(n - 1, period);
  atr[seedIdx] = sum / period;

  // Wilder smoothing
  for (let i = seedIdx + 1; i < n; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  
  // Forward-fill early values
  for (let i = 0; i < seedIdx; i++) atr[i] = atr[seedIdx];

  return atr;
}

/**
 * Simple Moving Average (full series)
 */
export function computeSMA(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array(n).fill(NaN);
  let sum = 0;
  
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  
  // Forward-fill NaN for early bars
  const first = out.findIndex(v => Number.isFinite(v));
  if (first >= 0) {
    for (let i = 0; i < first; i++) out[i] = out[first];
  }
  
  return out;
}

/**
 * Exponential Moving Average (full series)
 */
export function computeEMA(values: number[], period: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  
  const out = new Array(n).fill(NaN);
  const multiplier = 2 / (period + 1);
  
  // Seed with SMA
  if (n >= period) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    out[period - 1] = sum / period;
    
    // EMA calculation
    for (let i = period; i < n; i++) {
      out[i] = (values[i] - out[i - 1]) * multiplier + out[i - 1];
    }
  }
  
  // Forward-fill early values
  const first = out.findIndex(v => Number.isFinite(v));
  if (first >= 0) {
    for (let i = 0; i < first; i++) out[i] = out[first];
  }
  
  return out;
}

/**
 * Compute slope of values series
 * @param lookback - Number of bars for slope calculation
 */
export function computeSlope(values: number[], lookback = 10): number[] {
  const n = values.length;
  const out = new Array(n).fill(0);
  
  for (let i = 0; i < n; i++) {
    const j = Math.max(0, i - lookback);
    const denom = i - j || 1;
    out[i] = (values[i] - values[j]) / denom;
  }
  
  return out;
}

/**
 * RSI (Relative Strength Index)
 */
export function computeRSI(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const rsi = new Array(n).fill(50);
  
  if (n < period + 1) return rsi;
  
  const gains: number[] = [];
  const losses: number[] = [];
  
  // Calculate price changes
  for (let i = 1; i < n; i++) {
    const change = candles[i].close - candles[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  
  // Initial average gain/loss
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // Calculate RSI
  for (let i = period; i < n; i++) {
    if (i > period) {
      avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
    }
    
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi[i] = 100 - (100 / (1 + rs));
  }
  
  // Fill early values
  for (let i = 0; i < period; i++) rsi[i] = rsi[period];
  
  return rsi;
}

/**
 * MACD (Moving Average Convergence Divergence)
 */
export function computeMACD(
  candles: Candle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  const closes = candles.map(c => c.close);
  const emaFast = computeEMA(closes, fastPeriod);
  const emaSlow = computeEMA(closes, slowPeriod);
  
  const macd = emaFast.map((v, i) => v - emaSlow[i]);
  const signal = computeEMA(macd, signalPeriod);
  const histogram = macd.map((v, i) => v - signal[i]);
  
  return { macd, signal, histogram };
}

/**
 * Bollinger Bands
 */
export function computeBollingerBands(
  candles: Candle[],
  period = 20,
  stdDevMult = 2
): {
  upper: number[];
  middle: number[];
  lower: number[];
  bandwidth: number[];
} {
  const closes = candles.map(c => c.close);
  const middle = computeSMA(closes, period);
  const n = closes.length;
  
  const upper = new Array(n).fill(NaN);
  const lower = new Array(n).fill(NaN);
  const bandwidth = new Array(n).fill(0);
  
  for (let i = period - 1; i < n; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    
    upper[i] = mean + stdDev * stdDevMult;
    lower[i] = mean - stdDev * stdDevMult;
    bandwidth[i] = mean > 0 ? (upper[i] - lower[i]) / mean : 0;
  }
  
  return { upper, middle, lower, bandwidth };
}
