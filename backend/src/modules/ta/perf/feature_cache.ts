/**
 * Phase U: Performance Engine - Feature Cache
 * 
 * Compute-once cache for indicators and features.
 * All detectors read from this cache instead of computing themselves.
 */

import { OhlcvCandle } from '../domain/types.js';

export interface FeatureCache {
  // Indicators
  atr: number[];
  rsi: number[];
  macd: { macd: number[]; signal: number[]; hist: number[] };
  
  // Moving averages
  ma: {
    ma20: number[];
    ma50: number[];
    ma200: number[];
  };
  
  // Derived features
  volatility: number;
  avgVolume: number;
  trendStrength: number;
  
  // Metadata
  computed: boolean;
  computeTimeMs: number;
}

/**
 * Build feature cache from candles and existing indicators
 */
export function buildFeatureCache(
  candles: OhlcvCandle[],
  existingIndicators?: any,
  existingFeatures?: any
): FeatureCache {
  const start = Date.now();
  
  // Ensure candles is an array
  const safeCandles = Array.isArray(candles) ? candles : [];
  
  const cache: FeatureCache = {
    atr: existingIndicators?.atr || calculateATR(safeCandles, 14),
    rsi: existingIndicators?.rsi || calculateRSI(safeCandles, 14),
    macd: existingIndicators?.macd || calculateMACD(safeCandles),
    ma: {
      ma20: existingFeatures?.maSeries?.ma20 || calculateSMA(safeCandles, 20),
      ma50: existingFeatures?.maSeries?.ma50 || calculateSMA(safeCandles, 50),
      ma200: existingFeatures?.maSeries?.ma200 || calculateSMA(safeCandles, 200),
    },
    volatility: calculateVolatility(safeCandles),
    avgVolume: calculateAvgVolume(safeCandles),
    trendStrength: calculateTrendStrength(safeCandles),
    computed: true,
    computeTimeMs: Date.now() - start,
  };
  
  return cache;
}

// ═══════════════════════════════════════════════════════════════
// Helper calculations (only used if not provided)
// ═══════════════════════════════════════════════════════════════

function calculateATR(candles: OhlcvCandle[], period: number): number[] {
  const atr: number[] = new Array(candles.length).fill(0);
  if (candles.length < period + 1) return atr;

  // Calculate True Range
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    tr.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    ));
  }

  // First ATR is simple average
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i];
  }
  atr[period] = sum / period;

  // Subsequent ATR using smoothing
  for (let i = period + 1; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i - 1]) / period;
  }

  return atr;
}

function calculateRSI(candles: OhlcvCandle[], period: number): number[] {
  const rsi: number[] = new Array(candles.length).fill(50);
  if (candles.length < period + 1) return rsi;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const currentGain = change > 0 ? change : 0;
    const currentLoss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }

  return rsi;
}

function calculateMACD(candles: OhlcvCandle[]): { macd: number[]; signal: number[]; hist: number[] } {
  const macd: number[] = new Array(candles.length).fill(0);
  const signal: number[] = new Array(candles.length).fill(0);
  const hist: number[] = new Array(candles.length).fill(0);

  if (candles.length < 26) return { macd, signal, hist };

  const ema12 = calculateEMA(candles.map(c => c.close), 12);
  const ema26 = calculateEMA(candles.map(c => c.close), 26);

  for (let i = 25; i < candles.length; i++) {
    macd[i] = ema12[i] - ema26[i];
  }

  // Signal line (9-period EMA of MACD)
  const macdValues = macd.slice(25);
  const signalEma = calculateEMA(macdValues, 9);
  
  for (let i = 0; i < signalEma.length; i++) {
    const idx = i + 25;
    signal[idx] = signalEma[i];
    hist[idx] = macd[idx] - signal[idx];
  }

  return { macd, signal, hist };
}

function calculateEMA(values: number[], period: number): number[] {
  const ema: number[] = new Array(values.length).fill(0);
  if (values.length < period) return ema;

  const multiplier = 2 / (period + 1);
  
  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  ema[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    ema[i] = (values[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }

  return ema;
}

function calculateSMA(candles: OhlcvCandle[], period: number): number[] {
  const sma: number[] = new Array(candles.length).fill(0);
  
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close;
    }
    sma[i] = sum / period;
  }
  
  return sma;
}

function calculateVolatility(candles: OhlcvCandle[]): number {
  if (candles.length < 20) return 0;
  
  const returns: number[] = [];
  for (let i = 1; i < Math.min(candles.length, 50); i++) {
    returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }
  
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
  
  return Math.sqrt(variance) * Math.sqrt(252); // Annualized
}

function calculateAvgVolume(candles: OhlcvCandle[]): number {
  const recentCandles = candles.slice(-20);
  if (recentCandles.length === 0) return 0;
  
  const totalVolume = recentCandles.reduce((s, c) => s + (c.volume || 0), 0);
  return totalVolume / recentCandles.length;
}

function calculateTrendStrength(candles: OhlcvCandle[]): number {
  if (candles.length < 20) return 0;
  
  const recent = candles.slice(-20);
  const first = recent[0].close;
  const last = recent[recent.length - 1].close;
  
  return (last - first) / first;
}
