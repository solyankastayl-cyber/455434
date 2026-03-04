/**
 * Market Regime Tagger
 * ====================
 * 
 * v4.8.0: Added PROACTIVE regime tagging for pre-trade filtering.
 * 
 * Simple heuristic-based regime classification for trade segmentation.
 * 
 * Regimes:
 * - BULL: Uptrend (price above MA, positive slope)
 * - BEAR: Downtrend (price below MA, negative slope)
 * - CHOP: Sideways (low slope, low volatility relative to ATR)
 * - UNKNOWN: Insufficient data
 * 
 * Purpose:
 * - Understand WHERE the model performs well/poorly
 * - Filter trades during unfavorable regimes
 * - PROACTIVE gating: tag regime BEFORE entering trade (no future data)
 * - No ML here — just heuristics
 */

import { RegimeTag } from './exchange_trade_types.js';

// ═══════════════════════════════════════════════════════════════
// PROACTIVE REGIME TAGGER (v4.8.0) - BLOCK A
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate SMA (Simple Moving Average) from closes array.
 */
function calcSMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate ATR (Average True Range) as percentage of price.
 * Simplified: using daily range as proxy.
 */
function calcATRPct(closes: number[], period: number = 14): number {
  if (closes.length < 2) return 0.02; // Default 2%
  
  const ranges: number[] = [];
  for (let i = 1; i < closes.length && ranges.length < period; i++) {
    const curr = closes[closes.length - i];
    const prev = closes[closes.length - i - 1];
    if (prev > 0) {
      ranges.push(Math.abs(curr - prev) / prev);
    }
  }
  
  if (ranges.length === 0) return 0.02;
  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

/**
 * Calculate SMA slope (normalized daily change).
 */
function calcSMASlope(closes: number[], smaPeriod: number = 50, slopeDays: number = 5): number {
  if (closes.length < smaPeriod + slopeDays) return 0;
  
  const currentSMA = calcSMA(closes, smaPeriod);
  const pastCloses = closes.slice(0, -slopeDays);
  const pastSMA = calcSMA(pastCloses, smaPeriod);
  
  if (pastSMA === 0) return 0;
  return (currentSMA - pastSMA) / pastSMA / slopeDays;
}

/**
 * PROACTIVE REGIME TAGGER
 * 
 * Tags market regime using ONLY historical data up to the current index.
 * NO FUTURE DATA is used - safe for pre-trade filtering.
 * 
 * @param closes - Array of all close prices in the dataset
 * @param lookback - Number of days to use for regime calculation (default: 240)
 * @returns RegimeTag - 'BULL' | 'BEAR' | 'CHOP' | 'UNKNOWN'
 */
export function tagRegimeFromHistory(closes: number[], lookback: number = 240): RegimeTag {
  if (closes.length < 50) return 'UNKNOWN';
  
  // Use only the lookback window
  const window = closes.slice(-lookback);
  
  // Calculate indicators
  const sma50 = calcSMA(window, 50);
  const sma200 = window.length >= 200 ? calcSMA(window, 200) : sma50;
  const currentPrice = window[window.length - 1];
  const atrPct = calcATRPct(window, 14);
  const smaSlope = calcSMASlope(window, 50, 5);
  
  // Calculate price position relative to SMA
  const priceVsSma50 = sma50 > 0 ? (currentPrice - sma50) / sma50 : 0;
  
  // Thresholds
  const SLOPE_FLAT_THRESHOLD = 0.0005;   // 0.05% daily slope
  const ATR_LOW_THRESHOLD = 0.012;        // 1.2% ATR = low volatility
  const PRICE_DEVIATION_THRESHOLD = 0.02; // 2% from SMA50
  
  // 1. CHOP detection: flat slope AND/OR very low ATR
  const slopeFlat = Math.abs(smaSlope) < SLOPE_FLAT_THRESHOLD;
  const atrLow = atrPct > 0 && atrPct < ATR_LOW_THRESHOLD;
  
  if (slopeFlat || atrLow) {
    return 'CHOP';
  }
  
  // 2. Trend detection
  const slopeUp = smaSlope > SLOPE_FLAT_THRESHOLD;
  const slopeDown = smaSlope < -SLOPE_FLAT_THRESHOLD;
  const priceAboveSma = priceVsSma50 > PRICE_DEVIATION_THRESHOLD;
  const priceBelowSma = priceVsSma50 < -PRICE_DEVIATION_THRESHOLD;
  
  // BULL: upward slope + price above MA
  if (slopeUp && priceAboveSma) {
    return 'BULL';
  }
  
  // BEAR: downward slope + price below MA
  if (slopeDown && priceBelowSma) {
    return 'BEAR';
  }
  
  // 3. Golden/Death cross check
  if (sma50 > sma200 * 1.02) {
    return 'BULL';
  }
  if (sma50 < sma200 * 0.98) {
    return 'BEAR';
  }
  
  // 4. Conflicting signals
  return 'UNKNOWN';
}

/**
 * PROACTIVE REGIME AT INDEX
 * 
 * Tags regime at a specific index using ONLY data up to that index.
 * This is the main function for pre-trade filtering in simulation.
 * 
 * IMPORTANT: Does NOT use any data after index (no future leak).
 * 
 * @param allCloses - Full array of close prices
 * @param idx - Current day index (0-based)
 * @param lookback - Lookback window size (default: 240 days)
 * @returns RegimeTag
 */
export function tagRegimeAtIndex(allCloses: number[], idx: number, lookback: number = 240): RegimeTag {
  // Only use data up to and including the current index
  const start = Math.max(0, idx - lookback + 1);
  const slice = allCloses.slice(start, idx + 1);
  return tagRegimeFromHistory(slice, lookback);
}

// ═══════════════════════════════════════════════════════════════
// LEGACY REGIME TAGGER (for backwards compatibility)
// ═══════════════════════════════════════════════════════════════

export interface RegimeInput {
  // SMA50 slope (normalized, e.g., daily change / price)
  sma50Slope?: number;
  
  // ATR as % of price
  atrPct?: number;
  
  // Price relative to SMA50 (as %)
  priceVsSma50?: number;
  
  // EMA cross distance (EMA12 - EMA26 normalized)
  emaCrossDist?: number;
}

/**
 * Tag the current market regime based on simple heuristics.
 * 
 * Logic:
 * 1. If slope is flat (< 0.05%) AND ATR is low (< 1.2%) → CHOP
 * 2. If slope > 0 AND price > SMA50 → BULL
 * 3. If slope < 0 AND price < SMA50 → BEAR
 * 4. Otherwise → UNKNOWN (conflicting signals)
 */
export function tagRegime(opts: RegimeInput): RegimeTag {
  const slope = opts.sma50Slope ?? 0;
  const atr = opts.atrPct ?? 0.02; // Default 2%
  const priceVsSma = opts.priceVsSma50 ?? 0;
  const emaCross = opts.emaCrossDist ?? 0;
  
  // Thresholds (calibrated for crypto daily)
  const SLOPE_FLAT_THRESHOLD = 0.0005;   // 0.05% daily slope
  const ATR_LOW_THRESHOLD = 0.012;        // 1.2% ATR = low volatility
  const ATR_HIGH_THRESHOLD = 0.04;        // 4% ATR = high volatility
  const PRICE_DEVIATION_THRESHOLD = 0.02; // 2% from SMA50
  
  // 1. CHOP detection: flat slope OR very low ATR
  const slopeFlat = Math.abs(slope) < SLOPE_FLAT_THRESHOLD;
  const atrLow = atr > 0 && atr < ATR_LOW_THRESHOLD;
  
  if (slopeFlat || atrLow) {
    return 'CHOP';
  }
  
  // 2. Trend detection: consistent slope + price position
  const slopeUp = slope > SLOPE_FLAT_THRESHOLD;
  const slopeDown = slope < -SLOPE_FLAT_THRESHOLD;
  const priceAboveSma = priceVsSma > PRICE_DEVIATION_THRESHOLD;
  const priceBelowSma = priceVsSma < -PRICE_DEVIATION_THRESHOLD;
  
  // BULL: upward slope + price above MA + positive EMA cross
  if (slopeUp && (priceAboveSma || emaCross > 0.002)) {
    return 'BULL';
  }
  
  // BEAR: downward slope + price below MA + negative EMA cross
  if (slopeDown && (priceBelowSma || emaCross < -0.002)) {
    return 'BEAR';
  }
  
  // 3. Strong EMA cross can override slope
  if (emaCross > 0.005) {
    return 'BULL';
  }
  if (emaCross < -0.005) {
    return 'BEAR';
  }
  
  // 4. Conflicting signals
  return 'UNKNOWN';
}

// ═══════════════════════════════════════════════════════════════
// EXTENDED REGIME INFO
// ═══════════════════════════════════════════════════════════════

export interface ExtendedRegimeInfo {
  tag: RegimeTag;
  confidence: number;     // 0..1 how confident we are in the tag
  description: string;
  tradeable: boolean;     // Should we trade in this regime?
  sizeMultiplier: number; // Position size adjustment (0..1)
}

/**
 * Get extended regime information with trading recommendations.
 */
export function getExtendedRegime(opts: RegimeInput): ExtendedRegimeInfo {
  const tag = tagRegime(opts);
  const slope = Math.abs(opts.sma50Slope ?? 0);
  const atr = opts.atrPct ?? 0.02;
  
  switch (tag) {
    case 'BULL':
      return {
        tag,
        confidence: Math.min(1, slope * 500 + 0.5), // Higher slope = more confidence
        description: 'Uptrend: Price above MA with positive momentum',
        tradeable: true,
        sizeMultiplier: 1.0,
      };
      
    case 'BEAR':
      return {
        tag,
        confidence: Math.min(1, slope * 500 + 0.5),
        description: 'Downtrend: Price below MA with negative momentum',
        tradeable: true,
        sizeMultiplier: 1.0,
      };
      
    case 'CHOP':
      return {
        tag,
        confidence: atr < 0.01 ? 0.8 : 0.5, // Low ATR = more confident it's chop
        description: 'Sideways: No clear direction, low volatility',
        tradeable: false, // Don't trade in chop!
        sizeMultiplier: 0.25, // If forced to trade, minimal size
      };
      
    case 'UNKNOWN':
    default:
      return {
        tag: 'UNKNOWN',
        confidence: 0.3,
        description: 'Conflicting signals: Cannot determine regime',
        tradeable: false,
        sizeMultiplier: 0.5,
      };
  }
}

// ═══════════════════════════════════════════════════════════════
// REGIME STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface RegimeStats {
  regime: RegimeTag;
  dayCount: number;
  percentage: number;
}

/**
 * Analyze regime distribution over a time period.
 */
export function analyzeRegimeDistribution(
  regimes: RegimeTag[]
): Record<RegimeTag, RegimeStats> {
  const total = regimes.length;
  
  const counts: Record<RegimeTag, number> = {
    BULL: 0,
    BEAR: 0,
    CHOP: 0,
    UNKNOWN: 0,
  };
  
  for (const r of regimes) {
    counts[r]++;
  }
  
  return {
    BULL: { regime: 'BULL', dayCount: counts.BULL, percentage: counts.BULL / total },
    BEAR: { regime: 'BEAR', dayCount: counts.BEAR, percentage: counts.BEAR / total },
    CHOP: { regime: 'CHOP', dayCount: counts.CHOP, percentage: counts.CHOP / total },
    UNKNOWN: { regime: 'UNKNOWN', dayCount: counts.UNKNOWN, percentage: counts.UNKNOWN / total },
  };
}

console.log('[Exchange ML] Regime tagger v4.8.0 loaded (proactive tagging enabled)');
