/**
 * SPX REGIME ENGINE — Features Calculator
 * 
 * BLOCK B6.11 — Calculates regime features from candle data
 * 
 * All calculations are deterministic and based on fixed windows.
 */

import { REGIME_CONFIG, VOL_PERCENTILES, REGIME_THRESHOLDS, VolBucket, TrendDir } from './regime.config.js';

export interface RegimeFeatures {
  // Volatility
  vol20: number;           // 20-day realized vol (annualized)
  vol60: number;           // 60-day realized vol
  volBucket: VolBucket;
  
  // B6.13.1: Vol bucket lookback for transition detection
  volBucket5dAgo: VolBucket; // Vol bucket 5 days ago
  volExpanding: boolean;     // vol20 > vol60 and rising
  volContracting: boolean;   // vol20 < vol60 and falling
  
  // Drawdown
  maxDD60: number;         // Max drawdown over 60 days
  ddSpeed: number;         // Drawdown speed (% per day)
  daysToTrough: number;    // Days to reach trough
  
  // Trend
  sma50: number;           // SMA 50 value
  sma50Slope: number;      // SMA 50 slope (10-day change)
  sma50Slope5dAgo: number; // SMA 50 slope 5 days ago (for flip detection)
  trendDir: TrendDir;      // UP/DOWN/FLAT
  trendPersistence30: number; // % days same direction over 30d
  trendFlipping: boolean;  // SMA50 slope sign changed in last 5 days
  
  // Range detection
  wasRange: boolean;       // Low persistence 5 days ago
  isRange: boolean;        // Low persistence now
  rangeBreaking: boolean;  // Transition from range to trend
  
  // Shock/Rebound
  shock5: number;          // 5-day return
  rebound10: number;       // 10-day return from local low
  isShock: boolean;
  isVShape: boolean;
  
  // B6.13.2: Crisis Typology
  crashSpeedBucket: 'FAST' | 'SLOW' | 'NONE';  // FAST if ddSpeed > p66
  reboundType: 'VSHAPE' | 'NONV' | 'NONE';     // VSHAPE if rebound10 > p66
}

/**
 * Calculate daily log returns from closes
 */
function calcReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  return returns;
}

/**
 * Calculate realized volatility (annualized)
 */
function calcRealizedVol(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const sqDiffs = returns.map(r => Math.pow(r - mean, 2));
  const variance = sqDiffs.reduce((a, b) => a + b, 0) / returns.length;
  const dailyVol = Math.sqrt(variance);
  return dailyVol * Math.sqrt(REGIME_CONFIG.TRADING_DAYS);
}

/**
 * Calculate max drawdown and speed
 */
function calcDrawdown(closes: number[]): { maxDD: number; speed: number; daysToTrough: number } {
  if (closes.length < 2) return { maxDD: 0, speed: 0, daysToTrough: 0 };
  
  let peak = closes[0];
  let maxDD = 0;
  let troughIdx = 0;
  
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > peak) {
      peak = closes[i];
    }
    const dd = (closes[i] - peak) / peak;
    if (dd < maxDD) {
      maxDD = dd;
      troughIdx = i;
    }
  }
  
  const daysToTrough = troughIdx > 0 ? troughIdx : 1;
  const speed = Math.abs(maxDD) / daysToTrough;
  
  return { maxDD, speed, daysToTrough };
}

/**
 * Calculate SMA
 */
function calcSMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate trend persistence (% days in same direction)
 */
function calcTrendPersistence(closes: number[], window: number): number {
  if (closes.length < window + 1) return 0.5;
  
  const slice = closes.slice(-(window + 1));
  let upDays = 0;
  let downDays = 0;
  
  for (let i = 1; i < slice.length; i++) {
    if (slice[i] > slice[i - 1]) upDays++;
    else if (slice[i] < slice[i - 1]) downDays++;
  }
  
  const dominant = Math.max(upDays, downDays);
  return dominant / (window);
}

/**
 * Calculate 5-day shock return
 */
function calcShock(closes: number[], window: number = 5): number {
  if (closes.length < window + 1) return 0;
  const start = closes[closes.length - window - 1];
  const end = closes[closes.length - 1];
  return start > 0 ? (end - start) / start : 0;
}

/**
 * Calculate rebound from local minimum
 */
function calcRebound(closes: number[], lookbackWindow: number = 20, forwardWindow: number = 10): number {
  if (closes.length < lookbackWindow + forwardWindow) return 0;
  
  // Find local minimum in lookback window
  const lookbackSlice = closes.slice(-(lookbackWindow + forwardWindow), -forwardWindow);
  let minIdx = 0;
  let minVal = lookbackSlice[0];
  
  for (let i = 1; i < lookbackSlice.length; i++) {
    if (lookbackSlice[i] < minVal) {
      minVal = lookbackSlice[i];
      minIdx = i;
    }
  }
  
  // Calculate rebound from that minimum
  const forwardSlice = closes.slice(-forwardWindow);
  const maxForward = Math.max(...forwardSlice);
  
  return minVal > 0 ? (maxForward - minVal) / minVal : 0;
}

/**
 * Classify volatility bucket based on percentiles
 */
function classifyVolBucket(vol: number): VolBucket {
  if (vol < VOL_PERCENTILES.P33) return VolBucket.LOW;
  if (vol < VOL_PERCENTILES.P66) return VolBucket.MEDIUM;
  return VolBucket.HIGH;
}

/**
 * Classify trend direction based on SMA slope
 */
function classifyTrendDir(slope: number): TrendDir {
  if (slope > REGIME_THRESHOLDS.SLOPE_THRESHOLD) return TrendDir.UP;
  if (slope < -REGIME_THRESHOLDS.SLOPE_THRESHOLD) return TrendDir.DOWN;
  return TrendDir.FLAT;
}

/**
 * Calculate all regime features for a given point in time
 * 
 * @param closes - Array of closing prices up to current point
 * @returns RegimeFeatures object
 */
export function calculateRegimeFeatures(closes: number[]): RegimeFeatures {
  // Volatility calculations
  const returns = calcReturns(closes);
  const returns20 = returns.slice(-REGIME_CONFIG.VOL_WINDOW_SHORT);
  const returns60 = returns.slice(-REGIME_CONFIG.VOL_WINDOW_LONG);
  
  const vol20 = calcRealizedVol(returns20);
  const vol60 = calcRealizedVol(returns60);
  const volBucket = classifyVolBucket(vol20);
  
  // B6.13.1: Vol bucket 5 days ago for transition detection
  const closes5dAgo = closes.slice(0, -5);
  const returns5dAgo = calcReturns(closes5dAgo);
  const returns20_5dAgo = returns5dAgo.slice(-REGIME_CONFIG.VOL_WINDOW_SHORT);
  const vol20_5dAgo = calcRealizedVol(returns20_5dAgo);
  const volBucket5dAgo = classifyVolBucket(vol20_5dAgo);
  
  // Vol expansion/contraction
  const volExpanding = vol20 > vol60 && vol20 > vol20_5dAgo;
  const volContracting = vol20 < vol60 && vol20 < vol20_5dAgo;
  
  // Drawdown calculations
  const closes60 = closes.slice(-REGIME_CONFIG.DD_WINDOW);
  const dd = calcDrawdown(closes60);
  
  // Trend calculations
  const sma50 = calcSMA(closes, REGIME_CONFIG.SMA_PERIOD);
  const closes10Ago = closes.slice(0, -REGIME_CONFIG.SLOPE_WINDOW);
  const sma50Ago = calcSMA(closes10Ago, REGIME_CONFIG.SMA_PERIOD);
  const sma50Slope = (sma50 - sma50Ago) / REGIME_CONFIG.SLOPE_WINDOW;
  const trendDir = classifyTrendDir(sma50Slope);
  const trendPersistence30 = calcTrendPersistence(closes, REGIME_CONFIG.TREND_LOOKBACK);
  
  // B6.13.1: SMA50 slope 5 days ago for trend flip detection
  const closes15Ago = closes.slice(0, -15);
  const sma50_15Ago = calcSMA(closes15Ago, REGIME_CONFIG.SMA_PERIOD);
  const closes5Ago = closes.slice(0, -5);
  const sma50_5dAgo = calcSMA(closes5Ago, REGIME_CONFIG.SMA_PERIOD);
  const sma50Slope5dAgo = closes15Ago.length > 50 ? (sma50_5dAgo - sma50_15Ago) / REGIME_CONFIG.SLOPE_WINDOW : 0;
  
  // Trend flipping: slope sign changed
  const trendFlipping = (sma50Slope > 0 && sma50Slope5dAgo < 0) || (sma50Slope < 0 && sma50Slope5dAgo > 0);
  
  // Range detection (low persistence = range)
  const RANGE_THRESHOLD = 0.55; // Less than 55% same direction = range
  const trendPersistence5dAgo = closes5dAgo.length > 30 ? calcTrendPersistence(closes5dAgo, REGIME_CONFIG.TREND_LOOKBACK) : 0.5;
  const wasRange = trendPersistence5dAgo < RANGE_THRESHOLD;
  const isRange = trendPersistence30 < RANGE_THRESHOLD;
  const rangeBreaking = (wasRange && !isRange) || (!wasRange && isRange);
  
  // Shock/Rebound calculations
  const shock5 = calcShock(closes, REGIME_CONFIG.SHOCK_WINDOW);
  const rebound10 = calcRebound(closes, 20, REGIME_CONFIG.REBOUND_WINDOW);
  const isShock = shock5 <= REGIME_THRESHOLDS.SHOCK_THRESHOLD;
  const isVShape = isShock && rebound10 >= REGIME_THRESHOLDS.VSHAPE_REBOUND;
  
  return {
    vol20,
    vol60,
    volBucket,
    volBucket5dAgo,
    volExpanding,
    volContracting,
    maxDD60: dd.maxDD,
    ddSpeed: dd.speed,
    daysToTrough: dd.daysToTrough,
    sma50,
    sma50Slope,
    sma50Slope5dAgo,
    trendDir,
    trendPersistence30,
    trendFlipping,
    wasRange,
    isRange,
    rangeBreaking,
    shock5,
    rebound10,
    isShock,
    isVShape,
    // B6.13.2: Crisis Typology
    // Using fixed percentile thresholds based on historical analysis
    // FAST crash: ddSpeed > 0.8% per day (p66 approximation)
    // VSHAPE: rebound10 > 5% (p66 approximation)
    crashSpeedBucket: dd.speed > 0.008 ? 'FAST' as const : dd.speed > 0 ? 'SLOW' as const : 'NONE' as const,
    reboundType: rebound10 > 0.05 ? 'VSHAPE' as const : rebound10 > 0 ? 'NONV' as const : 'NONE' as const,
  };
}

export default calculateRegimeFeatures;
