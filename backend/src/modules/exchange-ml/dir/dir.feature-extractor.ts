/**
 * Direction Feature Extractor (Horizon-Specific v2.1)
 * ====================================================
 * 
 * Extracts momentum/trend/volatility features for direction prediction.
 * 
 * v2.1: Added 3 new features for improved accuracy:
 * - emaCrossDist: EMA(12) - EMA(26) trend signal
 * - distToVWAP7: Distance to 7-day VWAP (institutional anchor)
 * - volSpike20: Volume spike ratio (momentum/anomaly detector)
 * 
 * Key insight: Different horizons need different features:
 * - 1D: Short-term momentum (1h, 4h, 1d), micro-trend, RSI/ATR
 * - 7D: Medium-term (1d, 3d, 7d) momentum, MA20/50 distance, weekly RSI
 * - 30D: Long-term (7d, 14d, 30d) momentum, MA50/200 distance, vol regime, trend strength
 */

import { DirFeatureSnapshot, Horizon } from '../contracts/exchange.types.js';
import { DirPricePort, PriceBar } from './ports/dir.price.port.js';
import { ema, sma, vwap, clamp } from './dir.ta.utils.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface DirFeatureDeps {
  price: DirPricePort;
  getFlowBias: (symbol: string, t: number) => Promise<number>;
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXTRACTION FUNCTION (Horizon-Specific)
// ═══════════════════════════════════════════════════════════════

export async function buildDirFeatures(
  deps: DirFeatureDeps,
  args: { symbol: string; t: number; horizon: Horizon }
): Promise<DirFeatureSnapshot> {
  const { symbol, t, horizon } = args;
  
  // Get 220 days of daily bars for MA200 calculation (needed for 30D)
  const fromTs = t - 220 * 86400;
  const dayBars = await deps.price.getSeries({ symbol, from: fromTs, to: t, tf: '1d' });
  
  if (dayBars.length === 0) {
    console.warn(`[DirFeatures] No daily bars for ${symbol}`);
    return getEmptyFeatures();
  }
  
  const lastDay = dayBars[dayBars.length - 1];
  const closeDay = lastDay.close;
  
  // Get 7 days of hourly bars for intraday returns (1D horizon)
  const hourBars = await deps.price.getSeries({ symbol, from: t - 7 * 86400, to: t, tf: '1h' });
  const lastHour = hourBars[hourBars.length - 1];
  const closeHour = lastHour?.close ?? closeDay;
  
  // Extract arrays for TA calculations
  const closes = dayBars.map(b => b.close);
  const volumes = dayBars.map(b => b.volume);
  
  // ═══════════════════════════════════════════════════════════════
  // NEW v2.1 FEATURES: EMA Cross, VWAP Distance, Volume Spike
  // ═══════════════════════════════════════════════════════════════
  
  // A) EMA Cross Distance (trend/reversal signal)
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const emaCrossDist = (ema12 != null && ema26 != null)
    ? clamp(-0.25, 0.25, (ema12 - ema26) / Math.max(1e-9, closeDay))
    : 0;
  
  // B) Weekly VWAP Distance (institutional anchor)
  const vwap7 = vwap(closes, volumes, 7);
  const distToVWAP7 = (vwap7 != null)
    ? clamp(-0.35, 0.35, (closeDay - vwap7) / Math.max(1e-9, closeDay))
    : 0;
  
  // C) Volume Spike Ratio (momentum/anomaly detector)
  const volSma20 = sma(volumes, 20);
  const currentVol = volumes[volumes.length - 1] ?? 0;
  const volSpike20 = (volSma20 != null && volSma20 > 0)
    ? clamp(0, 6, currentVol / volSma20)
    : 1;
  
  // ═══════════════════════════════════════════════════════════════
  // SHARED BASE FEATURES (all horizons need these)
  // ═══════════════════════════════════════════════════════════════
  
  // ATR (volatility context) - critical for ATR-adjusted labeling
  const atr14 = calcATR(dayBars, 14);
  const atrN = closeDay > 0 ? clamp01(atr14 / closeDay) : 0.01;
  
  // RSI (mean reversion signal)
  const rsi14Raw = calcRSI(dayBars.map(b => b.close), 14);
  const rsi14 = clamp01(rsi14Raw / 100);
  
  // MA distances (trend context)
  const sma20 = calcSMA(dayBars, 20);
  const sma50 = calcSMA(dayBars, 50);
  const sma200 = calcSMA(dayBars, 200);
  
  const sma20_dist = closeDay > 0 ? clamp11((closeDay - sma20) / closeDay) : 0;
  const sma50_dist = closeDay > 0 ? clamp11((closeDay - sma50) / closeDay) : 0;
  const sma200_dist = closeDay > 0 ? clampWide((closeDay - sma200) / closeDay) : 0;
  
  // Flow bias (order flow alignment)
  const flowBias = await deps.getFlowBias(symbol, t);
  
  // ═══════════════════════════════════════════════════════════════
  // HORIZON-SPECIFIC FEATURE EXTRACTION
  // ═══════════════════════════════════════════════════════════════
  
  // Shared new v2.1 features object
  const v21Features = { emaCrossDist, distToVWAP7, volSpike20 };
  
  if (horizon === '1D') {
    return build1DFeatures({ hourBars, dayBars, closeHour, closeDay, atrN, rsi14, sma20_dist, sma50_dist, flowBias, ...v21Features });
  }
  
  if (horizon === '7D') {
    return build7DFeatures({ dayBars, closeDay, atrN, rsi14, sma20_dist, sma50_dist, sma200_dist, flowBias, ...v21Features });
  }
  
  // 30D
  return build30DFeatures({ dayBars, closeDay, atrN, rsi14, sma20_dist, sma50_dist, sma200_dist, flowBias, ...v21Features });
}

// ═══════════════════════════════════════════════════════════════
// 1D FEATURES: Short-term momentum focus
// ═══════════════════════════════════════════════════════════════

function build1DFeatures(params: {
  hourBars: PriceBar[];
  dayBars: PriceBar[];
  closeHour: number;
  closeDay: number;
  atrN: number;
  rsi14: number;
  sma20_dist: number;
  sma50_dist: number;
  flowBias: number;
  emaCrossDist: number;
  distToVWAP7: number;
  volSpike20: number;
}): DirFeatureSnapshot {
  const { hourBars, dayBars, closeHour, closeDay, atrN, rsi14, sma20_dist, sma50_dist, flowBias, emaCrossDist, distToVWAP7, volSpike20 } = params;
  
  // Short-term hourly returns (1D needs micro-momentum)
  const retFromHours = (h: number): number => {
    if (hourBars.length === 0) return 0;
    const idx = Math.max(0, hourBars.length - 1 - h);
    const prev = hourBars[idx]?.close ?? closeHour;
    return prev > 0 ? (closeHour / prev) - 1 : 0;
  };
  
  const ret_1h = retFromHours(1);
  const ret_4h = retFromHours(4);
  const ret_24h = retFromHours(24);
  
  // Daily returns
  const ret_3d = calcReturnFromDays(dayBars, closeDay, 3);
  const ret_7d = calcReturnFromDays(dayBars, closeDay, 7);
  
  return {
    ret_1h: clampReturn(ret_1h),
    ret_4h: clampReturn(ret_4h),
    ret_24h: clampReturn(ret_24h),
    ret_3d: clampReturn(ret_3d),
    ret_7d: clampReturn(ret_7d),
    sma20_dist,
    sma50_dist,
    rsi14,
    atrN,
    flowBias: clamp11(flowBias),
    emaCrossDist,
    distToVWAP7,
    volSpike20,
  };
}

// ═══════════════════════════════════════════════════════════════
// 7D FEATURES: Medium-term momentum + trend
// ═══════════════════════════════════════════════════════════════

function build7DFeatures(params: {
  dayBars: PriceBar[];
  closeDay: number;
  atrN: number;
  rsi14: number;
  sma20_dist: number;
  sma50_dist: number;
  sma200_dist: number;
  flowBias: number;
  emaCrossDist: number;
  distToVWAP7: number;
  volSpike20: number;
}): DirFeatureSnapshot {
  const { dayBars, closeDay, atrN, rsi14, sma20_dist, sma50_dist, sma200_dist, flowBias, emaCrossDist, distToVWAP7, volSpike20 } = params;
  
  // Medium-term daily returns (7D cares about weekly momentum)
  const ret_1d = calcReturnFromDays(dayBars, closeDay, 1);
  const ret_3d = calcReturnFromDays(dayBars, closeDay, 3);
  const ret_7d = calcReturnFromDays(dayBars, closeDay, 7);
  const ret_14d = calcReturnFromDays(dayBars, closeDay, 14);
  
  return {
    // Override short-term with 1d (not hourly - less noise for 7D)
    ret_1h: clampReturn(ret_1d),  // Using 1d instead of 1h
    ret_4h: clampReturn(ret_3d),  // Using 3d instead of 4h
    ret_24h: clampReturn(ret_7d), // Using 7d instead of 24h
    ret_3d: clampReturn(ret_7d),
    ret_7d: clampReturn(ret_14d), // Extend to 14d for 7D horizon
    sma20_dist,
    sma50_dist,
    rsi14,
    atrN,
    flowBias: clamp11(flowBias),
    emaCrossDist,
    distToVWAP7,
    volSpike20,
  };
}

// ═══════════════════════════════════════════════════════════════
// 30D FEATURES: Long-term trend + regime
// ═══════════════════════════════════════════════════════════════

function build30DFeatures(params: {
  dayBars: PriceBar[];
  closeDay: number;
  atrN: number;
  rsi14: number;
  sma20_dist: number;
  sma50_dist: number;
  sma200_dist: number;
  flowBias: number;
  emaCrossDist: number;
  distToVWAP7: number;
  volSpike20: number;
}): DirFeatureSnapshot {
  const { dayBars, closeDay, atrN, rsi14, sma20_dist, sma50_dist, sma200_dist, flowBias, emaCrossDist, distToVWAP7, volSpike20 } = params;
  
  // Long-term returns (30D needs weekly/monthly momentum)
  const ret_7d = calcReturnFromDays(dayBars, closeDay, 7);
  const ret_14d = calcReturnFromDays(dayBars, closeDay, 14);
  const ret_30d = calcReturnFromDays(dayBars, closeDay, 30);
  
  // Distance from all-time high (drawdown indicator)
  const maxHigh = Math.max(...dayBars.slice(-60).map(b => b.high));
  const distFromHigh = closeDay > 0 ? clamp11((closeDay - maxHigh) / maxHigh) : 0;
  
  return {
    // Long-term momentum (no short-term noise)
    ret_1h: clampReturn(ret_7d),   // Using 7d instead of 1h
    ret_4h: clampReturn(ret_14d),  // Using 14d instead of 4h
    ret_24h: clampReturn(ret_30d), // Using 30d instead of 24h
    ret_3d: clampReturn(ret_14d),
    ret_7d: clampReturn(ret_30d),
    // Use MA200 distance instead of MA20 for long-term trend
    sma20_dist: sma200_dist,  // Override: MA200 more relevant for 30D
    sma50_dist,
    rsi14,
    atrN,
    // Use distance from high as flow signal for 30D
    flowBias: clamp11(distFromHigh), // Override: trend strength indicator
    emaCrossDist,
    distToVWAP7,
    volSpike20,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Calculate return from N days ago
// ═══════════════════════════════════════════════════════════════

function calcReturnFromDays(dayBars: PriceBar[], closeDay: number, days: number): number {
  if (dayBars.length === 0) return 0;
  const idx = Math.max(0, dayBars.length - 1 - days);
  const prev = dayBars[idx]?.close ?? closeDay;
  return prev > 0 ? (closeDay / prev) - 1 : 0;
}

// ═══════════════════════════════════════════════════════════════
// FEATURE VECTOR CONVERSION
// ═══════════════════════════════════════════════════════════════

export const DIR_FEATURE_NAMES = [
  'ret_1h',
  'ret_4h',
  'ret_24h',
  'ret_3d',
  'ret_7d',
  'sma20_dist',
  'sma50_dist',
  'rsi14',
  'atrN',
  'flowBias',
  // v2.1: New features for improved accuracy
  'emaCrossDist',
  'distToVWAP7',
  'volSpike20',
] as const;

export function dirFeaturesToVector(features: DirFeatureSnapshot): number[] {
  return DIR_FEATURE_NAMES.map(name => features[name] ?? 0);
}

export function vectorToDirFeatures(vector: number[]): DirFeatureSnapshot {
  const features: any = {};
  DIR_FEATURE_NAMES.forEach((name, i) => {
    features[name] = vector[i] ?? 0;
  });
  return features as DirFeatureSnapshot;
}

// ═══════════════════════════════════════════════════════════════
// TECHNICAL INDICATOR CALCULATIONS
// ═══════════════════════════════════════════════════════════════

function calcSMA(bars: PriceBar[], period: number): number {
  if (bars.length === 0) return 0;
  const slice = bars.slice(-period);
  const sum = slice.reduce((acc, bar) => acc + bar.close, 0);
  return slice.length > 0 ? sum / slice.length : bars[bars.length - 1].close;
}

function calcRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50; // Neutral RSI
  
  let gains = 0;
  let losses = 0;
  
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      gains += diff;
    } else {
      losses -= diff; // Make positive
    }
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcATR(bars: PriceBar[], period: number): number {
  if (bars.length < period + 1) return 0;
  
  const trs: number[] = [];
  
  for (let i = bars.length - period; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    
    trs.push(tr);
  }
  
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function clamp11(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

function clampWide(x: number): number {
  // Wider range for MA200 distance (-80% to +80%)
  return Math.max(-0.8, Math.min(0.8, x));
}

function clampReturn(x: number): number {
  // Clamp returns to reasonable range (-50% to +50%)
  return Math.max(-0.5, Math.min(0.5, x));
}

function getEmptyFeatures(): DirFeatureSnapshot {
  return {
    ret_1h: 0,
    ret_4h: 0,
    ret_24h: 0,
    ret_3d: 0,
    ret_7d: 0,
    sma20_dist: 0,
    sma50_dist: 0,
    rsi14: 0.5,
    atrN: 0,
    flowBias: 0,
    // v2.1: New features
    emaCrossDist: 0,
    distToVWAP7: 0,
    volSpike20: 1,
  };
}

console.log('[Exchange ML] Direction feature extractor loaded');
