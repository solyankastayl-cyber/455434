/**
 * SPX PHASE ENGINE — Classifier
 * 
 * BLOCK B5.4 — Daily Phase Classification
 * 
 * Uses macro signals to classify each day into SPX-native phases.
 * SPX cycles are slower and more structural than BTC.
 */

import type { 
  SpxCandle, 
  SpxDailyPhaseLabel, 
  SpxPhaseType, 
  SpxPhaseFlag 
} from './spx-phase.types.js';

// ═══════════════════════════════════════════════════════════════
// MATH HELPERS
// ═══════════════════════════════════════════════════════════════

function sma(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

function slope(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period || isNaN(values[i]) || isNaN(values[i - period])) {
      result.push(0);
    } else {
      // Normalized slope: (current - past) / past
      const past = values[i - period];
      const current = values[i];
      result.push(past > 0 ? (current - past) / past : 0);
    }
  }
  return result;
}

function rollingStd(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
      result.push(Math.sqrt(variance));
    }
  }
  return result;
}

function rollingReturns(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      result.push(0);
    } else {
      const past = prices[i - period];
      result.push(past > 0 ? (prices[i] - past) / past : 0);
    }
  }
  return result;
}

function rolling52wHigh(highs: number[]): number[] {
  const period = 252; // ~1 year trading days
  const result: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = highs.slice(start, i + 1);
    result.push(Math.max(...slice));
  }
  return result;
}

function zscore(values: number[], lookback: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < lookback || isNaN(values[i])) {
      result.push(0);
    } else {
      const slice = values.slice(i - lookback + 1, i + 1).filter(v => !isNaN(v));
      if (slice.length < 10) {
        result.push(0);
        continue;
      }
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
      const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length);
      result.push(std > 0 ? (values[i] - mean) / std : 0);
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// MAIN CLASSIFIER
// ═══════════════════════════════════════════════════════════════

export function classifySpxPhases(candles: SpxCandle[]): SpxDailyPhaseLabel[] {
  if (candles.length < 250) {
    return []; // Need at least 1 year of data for SMA200
  }

  const closes = candles.map(c => c.c);
  const highs = candles.map(c => c.h);

  // Calculate signals
  const sma200 = sma(closes, 200);
  const sma200Slopes = slope(sma200, 30);
  
  const mom63d = rollingReturns(closes, 63);
  const mom126d = rollingReturns(closes, 126);
  
  // Rolling volatility (30-day returns std, annualized)
  const dailyReturns = closes.map((c, i) => i > 0 ? (c - closes[i-1]) / closes[i-1] : 0);
  const rv30 = rollingStd(dailyReturns, 30).map(v => v * Math.sqrt(252)); // Annualized
  const rvZ = zscore(rv30, 252);
  
  // 52-week high for drawdown
  const high52w = rolling52wHigh(highs);

  const labels: SpxDailyPhaseLabel[] = [];

  // Start from index 200 (need SMA200)
  for (let i = 200; i < candles.length; i++) {
    const price = closes[i];
    const s200 = sma200[i];
    const s200Slope = sma200Slopes[i];
    
    const priceVsSma200Pct = s200 > 0 ? ((price - s200) / s200) * 100 : 0;
    const momentum63 = mom63d[i];
    const momentum126 = mom126d[i];
    const volZ = rvZ[i];
    const drawdown = high52w[i] > 0 ? ((price - high52w[i]) / high52w[i]) * 100 : 0;

    // Classify phase
    const above200 = price > s200;
    const trendUp = s200Slope > 0.001; // SMA200 rising
    const trendDown = s200Slope < -0.001; // SMA200 falling

    let phase: SpxPhaseType = 'SIDEWAYS_RANGE';
    const flags: SpxPhaseFlag[] = [];

    // VOL_SHOCK flag (always check first)
    if (volZ > 2) {
      flags.push('VOL_SHOCK');
    }

    // DEEP_DRAWDOWN flag
    if (drawdown < -15) {
      flags.push('DEEP_DRAWDOWN');
    }

    // TREND_BREAK flag (SMA200 slope reversal)
    if (i > 0 && Math.sign(sma200Slopes[i]) !== Math.sign(sma200Slopes[i - 1]) && Math.abs(sma200Slopes[i]) > 0.002) {
      flags.push('TREND_BREAK');
    }

    // Phase classification logic
    if (above200 && trendUp && momentum63 > 0.05) {
      // Strong bull: above SMA200, SMA200 rising, positive momentum
      phase = 'BULL_EXPANSION';
    } 
    else if (above200 && (momentum63 < 0 || volZ > 1)) {
      // Bull cooldown: above SMA200 but momentum negative or vol rising
      phase = 'BULL_COOLDOWN';
    } 
    else if (!above200 && momentum63 < -0.05) {
      // Bear drawdown: below SMA200, negative momentum
      phase = 'BEAR_DRAWDOWN';
    } 
    else if (!above200 && momentum63 > 0) {
      // Bear rally: below SMA200 but short momentum positive (bounce)
      phase = 'BEAR_RALLY';
    }
    // else: SIDEWAYS_RANGE (default)

    labels.push({
      t: candles[i].t,
      ts: candles[i].ts,
      phase,
      flags,
      sma200: Math.round(s200 * 100) / 100,
      sma200Slope: Math.round(s200Slope * 10000) / 10000,
      priceVsSma200Pct: Math.round(priceVsSma200Pct * 100) / 100,
      mom63d: Math.round(momentum63 * 10000) / 10000,
      mom126d: Math.round(momentum126 * 10000) / 10000,
      rv30ZScore: Math.round(volZ * 100) / 100,
      drawdownFrom52wHigh: Math.round(drawdown * 100) / 100,
    });
  }

  return labels;
}

export default classifySpxPhases;
