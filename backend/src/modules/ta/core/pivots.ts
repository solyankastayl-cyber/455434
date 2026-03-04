/**
 * Pivot Engine — ATR-Adaptive ZigZag
 * 
 * CORE COMPONENT of TA system.
 * All pattern detectors depend on this.
 * 
 * Features:
 * - ATR-adaptive reversal threshold
 * - Minimum distance between pivots
 * - Percentage threshold protection
 * - Strict HIGH/LOW alternation
 * - Strength scoring
 */

import { Candle, Pivot, PivotType, PivotConfig } from '../domain/types.js';

/**
 * Default pivot configuration
 */
export const DEFAULT_PIVOT_CONFIG: PivotConfig = {
  atrMult: 1.5,         // reversal threshold = ATR * 1.5
  minBarsBetween: 3,    // minimum 3 bars between pivots
  minMovePct: 0.003     // 0.3% minimum move
};

/**
 * Calculate pivot strength based on move size relative to ATR
 */
function pivotStrength(moveAbs: number, atr: number): number {
  // strength ~ move/ATR, capped at 3
  const x = atr > 0 ? moveAbs / atr : 0;
  return Math.max(0, Math.min(3, x));
}

/**
 * Compute pivots using ATR-adaptive ZigZag algorithm
 * 
 * @param candles - OHLC candle data
 * @param atr - Pre-computed ATR series
 * @param cfg - Pivot configuration
 * @returns Array of detected pivots
 */
export function computePivotsZigZagATR(
  candles: Candle[],
  atr: number[],
  cfg: PivotConfig = DEFAULT_PIVOT_CONFIG
): Pivot[] {
  const n = candles.length;
  if (n < 3) return [];

  const atrMult = cfg.atrMult ?? 1.5;
  const minBars = cfg.minBarsBetween ?? 3;
  const minMovePct = cfg.minMovePct ?? 0.003;

  // State
  let lastPivotIdx = 0;
  let lastPivotPrice = candles[0].close;
  let lastPivotType: PivotType = "LOW"; // start condition

  // Candidate extreme tracking
  let extremeIdx = 0;
  let extremePrice = candles[0].close;

  // Direction: +1 seeking high, -1 seeking low
  let dir: 1 | -1 = 1;

  const pivots: Pivot[] = [];

  /**
   * Calculate reversal threshold at given index
   */
  const reversalThreshold = (i: number, basePrice: number): number => {
    const a = atr[i] || atr[Math.max(0, i - 1)] || 0;
    const absThr = a * atrMult;
    const pctThr = Math.abs(basePrice) * minMovePct;
    return Math.max(absThr, pctThr);
  };

  // Initialize
  extremeIdx = 0;
  extremePrice = candles[0].close;

  for (let i = 1; i < n; i++) {
    const priceHigh = candles[i].high;
    const priceLow = candles[i].low;

    if (dir === 1) {
      // Tracking highest high
      if (priceHigh >= extremePrice) {
        extremePrice = priceHigh;
        extremeIdx = i;
      }

      // Check reversal down from extreme
      const thr = reversalThreshold(i, extremePrice);
      if (extremePrice - priceLow >= thr && i - lastPivotIdx >= minBars) {
        // Confirm HIGH pivot at extremeIdx
        const moveAbs = Math.abs(extremePrice - lastPivotPrice);
        pivots.push({
          i: extremeIdx,
          ts: candles[extremeIdx].ts,
          price: extremePrice,
          type: "HIGH",
          strength: pivotStrength(moveAbs, atr[extremeIdx] || 0),
        });

        lastPivotIdx = extremeIdx;
        lastPivotPrice = extremePrice;
        lastPivotType = "HIGH";

        // Switch direction
        dir = -1;
        extremeIdx = i;
        extremePrice = priceLow;
      }
    } else {
      // dir === -1: tracking lowest low
      if (priceLow <= extremePrice) {
        extremePrice = priceLow;
        extremeIdx = i;
      }

      // Check reversal up from extreme
      const thr = reversalThreshold(i, extremePrice);
      if (priceHigh - extremePrice >= thr && i - lastPivotIdx >= minBars) {
        // Confirm LOW pivot at extremeIdx
        const moveAbs = Math.abs(lastPivotPrice - extremePrice);
        pivots.push({
          i: extremeIdx,
          ts: candles[extremeIdx].ts,
          price: extremePrice,
          type: "LOW",
          strength: pivotStrength(moveAbs, atr[extremeIdx] || 0),
        });

        lastPivotIdx = extremeIdx;
        lastPivotPrice = extremePrice;
        lastPivotType = "LOW";

        // Switch direction
        dir = 1;
        extremeIdx = i;
        extremePrice = priceHigh;
      }
    }
  }

  // Ensure alternation and remove duplicates
  return enforceAlternation(pivots);
}

/**
 * Enforce strict HIGH/LOW alternation
 * Keeps the more extreme pivot when duplicates occur
 */
function enforceAlternation(p: Pivot[]): Pivot[] {
  if (p.length < 2) return p;
  
  const out: Pivot[] = [];
  
  for (const pv of p) {
    const last = out[out.length - 1];
    
    if (!last) {
      out.push(pv);
      continue;
    }
    
    if (last.type === pv.type) {
      // Same type - keep the more extreme one
      if (pv.type === "HIGH") {
        if (pv.price > last.price) out[out.length - 1] = pv;
      } else {
        if (pv.price < last.price) out[out.length - 1] = pv;
      }
    } else {
      out.push(pv);
    }
  }
  
  return out;
}

/**
 * Get recent pivots (last N)
 */
export function getRecentPivots(pivots: Pivot[], count: number = 10): Pivot[] {
  return pivots.slice(-count);
}

/**
 * Filter pivots by type
 */
export function filterPivotsByType(pivots: Pivot[], type: PivotType): Pivot[] {
  return pivots.filter(p => p.type === type);
}

/**
 * Get swing highs only
 */
export function getSwingHighs(pivots: Pivot[]): Pivot[] {
  return filterPivotsByType(pivots, "HIGH");
}

/**
 * Get swing lows only
 */
export function getSwingLows(pivots: Pivot[]): Pivot[] {
  return filterPivotsByType(pivots, "LOW");
}

/**
 * Calculate average pivot strength
 */
export function avgPivotStrength(pivots: Pivot[]): number {
  if (pivots.length === 0) return 0;
  return pivots.reduce((sum, p) => sum + p.strength, 0) / pivots.length;
}
