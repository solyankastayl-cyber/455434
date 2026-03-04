/**
 * Market Metrics Builder Service (P1.5)
 * 
 * Computes aggregates: volatility, volume z-score, price changes.
 * These are CONTEXT, not signals.
 */

import {
  getCandles,
  CandleInterval,
  IMarketCandle
} from '../storage/market_candle.model.js';
import {
  upsertMetric,
  MetricWindow,
  MarketRegime,
  IMarketMetric
} from '../storage/market_metric.model.js';

// ============================================
// Types
// ============================================

export interface MetricsBuildResult {
  symbol: string;
  window: MetricWindow;
  metric: IMarketMetric;
  candlesUsed: number;
}

// ============================================
// Window Configuration
// ============================================

const WINDOW_TO_MS: Record<MetricWindow, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
};

// ============================================
// Regime Classification Thresholds
// ============================================

const REGIME_THRESHOLDS = {
  // Volatility thresholds (as percentage)
  CALM_MAX_VOL: 2,        // < 2% = CALM
  VOLATILE_MAX_VOL: 5,    // 2-5% = VOLATILE
  // > 5% = STRESSED
  
  // Volume z-score thresholds
  VOLUME_ANOMALY_Z: 2.5,
  
  // Price change thresholds
  PRICE_STRESS_PCT: 8     // > 8% move = stress indicator
};

// ============================================
// Metrics Builder
// ============================================

/**
 * Build metrics for a symbol/window
 */
export async function buildMetrics(
  symbol: string,
  window: MetricWindow,
  interval: CandleInterval = '1h'
): Promise<MetricsBuildResult | null> {
  const now = Date.now();
  const windowMs = WINDOW_TO_MS[window];
  const fromTs = now - windowMs;
  
  // Get candles for window
  const candles = await getCandles(
    symbol,
    interval,
    fromTs,
    now,
    undefined,
    5000
  );
  
  if (candles.length === 0) {
    return null;
  }
  
  // Calculate metrics
  const metric = calculateMetrics(symbol, interval, window, candles, now);
  
  // Save to database
  await upsertMetric(metric);
  
  return {
    symbol,
    window,
    metric,
    candlesUsed: candles.length
  };
}

/**
 * Build metrics for all windows
 */
export async function buildAllMetrics(
  symbol: string,
  interval: CandleInterval = '1h'
): Promise<MetricsBuildResult[]> {
  const windows: MetricWindow[] = ['1h', '24h', '7d'];
  const results: MetricsBuildResult[] = [];
  
  for (const window of windows) {
    const result = await buildMetrics(symbol, window, interval);
    if (result) {
      results.push(result);
    }
  }
  
  return results;
}

// ============================================
// Calculation Functions
// ============================================

function calculateMetrics(
  symbol: string,
  interval: string,
  window: MetricWindow,
  candles: IMarketCandle[],
  ts: number
): IMarketMetric {
  // Sort by timestamp
  const sorted = [...candles].sort((a, b) => a.ts - b.ts);
  
  // Price data
  const prices = sorted.map(c => c.c);
  const volumes = sorted.map(c => c.v);
  
  // Basic price stats
  const priceOpen = sorted[0].o;
  const priceClose = sorted[sorted.length - 1].c;
  const priceHigh = Math.max(...sorted.map(c => c.h));
  const priceLow = Math.min(...sorted.map(c => c.l));
  const priceChangePct = priceOpen > 0 
    ? ((priceClose - priceOpen) / priceOpen) * 100 
    : 0;
  
  // Volatility (standard deviation of returns)
  const returns = calculateReturns(prices);
  const volatility = calculateStdDev(returns);
  const volatilityPct = volatility * 100;
  
  // Volume stats
  const volumeMean = calculateMean(volumes);
  const volumeStd = calculateStdDev(volumes);
  const currentVolume = volumes[volumes.length - 1] || 0;
  const volumeZ = volumeStd > 0 
    ? clamp((currentVolume - volumeMean) / volumeStd, -3, 3) 
    : 0;
  const volumeTotal = volumes.reduce((a, b) => a + b, 0);
  
  // Quality score (based on data completeness)
  const expectedCandles = getExpectedCandleCount(window, interval);
  const qualityScore = Math.min(100, Math.round((candles.length / expectedCandles) * 100));
  
  // Regime classification
  const { regime, regimeScore } = classifyRegime(
    volatilityPct,
    volumeZ,
    Math.abs(priceChangePct)
  );
  
  return {
    symbol: symbol.toUpperCase(),
    interval,
    window,
    ts,
    
    volatility: round(volatility, 6),
    volatilityPct: round(volatilityPct, 4),
    
    volumeMean: round(volumeMean, 2),
    volumeStd: round(volumeStd, 2),
    volumeZ: round(volumeZ, 4),
    volumeTotal: round(volumeTotal, 2),
    
    priceChangePct: round(priceChangePct, 4),
    priceHigh: round(priceHigh, 8),
    priceLow: round(priceLow, 8),
    priceOpen: round(priceOpen, 8),
    priceClose: round(priceClose, 8),
    
    regime,
    regimeScore,
    
    candleCount: candles.length,
    qualityScore,
    
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function classifyRegime(
  volatilityPct: number,
  volumeZ: number,
  priceChangePct: number
): { regime: MarketRegime; regimeScore: number } {
  let score = 0;
  
  // Volatility contribution (0-40 points)
  if (volatilityPct < REGIME_THRESHOLDS.CALM_MAX_VOL) {
    score += 0;
  } else if (volatilityPct < REGIME_THRESHOLDS.VOLATILE_MAX_VOL) {
    score += 20;
  } else {
    score += 40;
  }
  
  // Volume anomaly contribution (0-30 points)
  if (Math.abs(volumeZ) > REGIME_THRESHOLDS.VOLUME_ANOMALY_Z) {
    score += 30;
  } else if (Math.abs(volumeZ) > 1.5) {
    score += 15;
  }
  
  // Price change contribution (0-30 points)
  if (priceChangePct > REGIME_THRESHOLDS.PRICE_STRESS_PCT) {
    score += 30;
  } else if (priceChangePct > 4) {
    score += 15;
  }
  
  // Classify based on score
  let regime: MarketRegime;
  if (score < 30) {
    regime = 'CALM';
  } else if (score < 60) {
    regime = 'VOLATILE';
  } else {
    regime = 'STRESSED';
  }
  
  return { regime, regimeScore: score };
}

// ============================================
// Math Helpers
// ============================================

function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  return returns;
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = calculateMean(values);
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(calculateMean(squaredDiffs));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function getExpectedCandleCount(window: MetricWindow, interval: string): number {
  const windowMs = WINDOW_TO_MS[window];
  
  const intervalMs: Record<string, number> = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000
  };
  
  const intMs = intervalMs[interval] || 60 * 60 * 1000;
  return Math.floor(windowMs / intMs);
}
