/**
 * Volatility Engine — ATR Percentile & Regime Detection
 * 
 * Phase 7: Feature Pack
 * 
 * Computes:
 * - Current ATR value
 * - ATR percentile over lookback window
 * - Volatility regime (LOW/NORMAL/HIGH)
 * - Vol Gate multiplier for scoring
 */

import { TAContext, VolPack, VolRegime } from '../domain/types.js';

// Configuration
const VOL_CONFIG = {
  lookbackPeriod: 180,    // ~6 months for 1D
  lowThreshold: 0.25,     // percentile below this = LOW
  highThreshold: 0.75,    // percentile above this = HIGH
  extremeThreshold: 0.90, // percentile above this = extreme (gate penalty)
  gateMin: 0.5,           // minimum gate value in extreme conditions
};

/**
 * Build Volatility Pack from TAContext
 */
export function buildVolPack(ctx: TAContext): VolPack {
  const { series, atr, structure } = ctx;
  const candles = series.candles;
  const n = candles.length;
  
  if (n === 0 || atr.length === 0) {
    return createEmptyVolPack();
  }

  const lastIdx = n - 1;
  const currentPrice = candles[lastIdx].close;
  const atrNow = atr[lastIdx];

  // ATR as percentage of price
  const atrPct = currentPrice > 0 ? atrNow / currentPrice : 0;

  // Calculate ATR percentile
  const atrPctile = calculateATRPercentile(atr, VOL_CONFIG.lookbackPeriod);

  // Determine volatility regime
  const regime = determineVolRegime(atrPctile);

  // Calculate vol gate (scoring multiplier)
  const volGate = calculateVolGate(atrPctile);

  // Get compression from structure
  const compression = structure.compressionScore;

  return {
    atrNow,
    atrPct,
    atrPctile,
    regime,
    compression,
    volGate,
  };
}

/**
 * Calculate ATR percentile over lookback window
 * Returns 0..1 where 0.5 = median, 1 = highest
 */
function calculateATRPercentile(atr: number[], lookback: number): number {
  const n = atr.length;
  if (n === 0) return 0.5;

  const currentATR = atr[n - 1];
  const start = Math.max(0, n - lookback);
  const window = atr.slice(start);
  
  if (window.length === 0) return 0.5;

  // Sort to find percentile
  const sorted = [...window].sort((a, b) => a - b);
  
  // Count how many values are below current ATR
  let below = 0;
  for (const v of sorted) {
    if (v < currentATR) below++;
    else break;
  }
  
  return below / sorted.length;
}

/**
 * Determine volatility regime from percentile
 */
function determineVolRegime(percentile: number): VolRegime {
  if (percentile < VOL_CONFIG.lowThreshold) {
    return "LOW";
  }
  if (percentile > VOL_CONFIG.highThreshold) {
    return "HIGH";
  }
  return "NORMAL";
}

/**
 * Calculate vol gate multiplier for scoring
 * 
 * In extreme volatility, we want to reduce confidence:
 * - Normal volatility: gate = 1.0
 * - High volatility: gate decreases linearly
 * - Extreme volatility: gate = gateMin
 */
function calculateVolGate(percentile: number): number {
  if (percentile <= VOL_CONFIG.highThreshold) {
    return 1.0;
  }
  
  if (percentile >= VOL_CONFIG.extremeThreshold) {
    return VOL_CONFIG.gateMin;
  }
  
  // Linear interpolation between high and extreme
  const range = VOL_CONFIG.extremeThreshold - VOL_CONFIG.highThreshold;
  const position = percentile - VOL_CONFIG.highThreshold;
  const factor = 1 - (position / range) * (1 - VOL_CONFIG.gateMin);
  
  return Math.max(VOL_CONFIG.gateMin, factor);
}

/**
 * Create empty Vol Pack for edge cases
 */
function createEmptyVolPack(): VolPack {
  return {
    atrNow: 0,
    atrPct: 0,
    atrPctile: 0.5,
    regime: "NORMAL",
    compression: 0,
    volGate: 1.0,
  };
}

/**
 * Flatten Vol Pack to features map
 */
export function flattenVolPack(pack: VolPack): Record<string, number> {
  return {
    vol_atrNow: pack.atrNow,
    vol_atrPct: pack.atrPct,
    vol_atrPctile: pack.atrPctile,
    vol_regime: pack.regime === "LOW" ? -1 : pack.regime === "HIGH" ? 1 : 0,
    vol_compression: pack.compression,
    vol_gate: pack.volGate,
  };
}

/**
 * Check if we're in a volatility compression regime
 * (useful for breakout detection)
 */
export function isVolatilityCompression(pack: VolPack): boolean {
  return pack.regime === "LOW" && pack.compression > 0.6;
}

/**
 * Check if volatility is expanding
 * (useful for trend confirmation)
 */
export function isVolatilityExpanding(pack: VolPack): boolean {
  return pack.regime === "HIGH" && pack.atrPctile > 0.8;
}
