/**
 * MA Engine — Moving Average Feature Pack
 * 
 * Phase 7: Feature Pack
 * 
 * Computes:
 * - MA20/50/200 values
 * - Slopes for each MA
 * - Distance from price to each MA
 * - Golden/Death cross detection
 * - MA alignment (BULL/BEAR/MIXED)
 */

import { TAContext, MAPack } from '../domain/types.js';
import { computeSMA, computeSlope } from '../core/indicators.js';

/**
 * Build MA Pack from TAContext
 */
export function buildMAPack(ctx: TAContext): MAPack {
  const { series, ma50, ma200, maSlope50, maSlope200 } = ctx;
  const candles = series.candles;
  const n = candles.length;
  
  if (n === 0) {
    return createEmptyMAPack();
  }

  const lastIdx = n - 1;
  const currentPrice = candles[lastIdx].close;
  const closes = candles.map(c => c.close);

  // Compute MA20 (not pre-computed in TAContext)
  const ma20Arr = computeSMA(closes, 20);
  const slope20Arr = computeSlope(ma20Arr, 5);

  // Get last values
  const ma20 = ma20Arr[lastIdx] ?? currentPrice;
  const ma50Val = ma50[lastIdx] ?? currentPrice;
  const ma200Val = ma200[lastIdx] ?? currentPrice;
  
  const slope20 = slope20Arr[lastIdx] ?? 0;
  const slope50 = maSlope50[lastIdx] ?? 0;
  const slope200 = maSlope200[lastIdx] ?? 0;

  // Distance from price to MA (positive = price above MA)
  const dist20 = ma20 > 0 ? (currentPrice / ma20 - 1) : 0;
  const dist50 = ma50Val > 0 ? (currentPrice / ma50Val - 1) : 0;
  const dist200 = ma200Val > 0 ? (currentPrice / ma200Val - 1) : 0;

  // Detect Golden/Death Cross
  // Look at recent bars for cross event
  const cross50_200 = detectMACross(ma50, ma200, 10);

  // Determine MA alignment
  const alignment = determineAlignment(ma20, ma50Val, ma200Val);

  return {
    ma20,
    ma50: ma50Val,
    ma200: ma200Val,
    slope20,
    slope50,
    slope200,
    dist20,
    dist50,
    dist200,
    cross50_200,
    alignment,
  };
}

/**
 * Detect Golden/Death Cross in recent bars
 * Returns: +1 (golden), -1 (death), 0 (none)
 */
function detectMACross(
  ma50: number[],
  ma200: number[],
  lookback: number
): -1 | 0 | 1 {
  const n = ma50.length;
  if (n < 2) return 0;

  const start = Math.max(0, n - lookback);
  
  for (let i = start + 1; i < n; i++) {
    const prev50 = ma50[i - 1];
    const prev200 = ma200[i - 1];
    const curr50 = ma50[i];
    const curr200 = ma200[i];
    
    // Golden Cross: MA50 crosses above MA200
    if (prev50 <= prev200 && curr50 > curr200) {
      return 1;
    }
    
    // Death Cross: MA50 crosses below MA200
    if (prev50 >= prev200 && curr50 < curr200) {
      return -1;
    }
  }
  
  return 0;
}

/**
 * Determine MA alignment
 * BULL: MA20 > MA50 > MA200 (all MAs stacked bullishly)
 * BEAR: MA20 < MA50 < MA200 (all MAs stacked bearishly)
 * MIXED: Any other configuration
 */
function determineAlignment(
  ma20: number,
  ma50: number,
  ma200: number
): "BULL" | "BEAR" | "MIXED" {
  if (ma20 > ma50 && ma50 > ma200) {
    return "BULL";
  }
  if (ma20 < ma50 && ma50 < ma200) {
    return "BEAR";
  }
  return "MIXED";
}

/**
 * Create empty MA Pack for edge cases
 */
function createEmptyMAPack(): MAPack {
  return {
    ma20: 0,
    ma50: 0,
    ma200: 0,
    slope20: 0,
    slope50: 0,
    slope200: 0,
    dist20: 0,
    dist50: 0,
    dist200: 0,
    cross50_200: 0,
    alignment: "MIXED",
  };
}

/**
 * Flatten MA Pack to features map
 */
export function flattenMAPack(pack: MAPack): Record<string, number> {
  return {
    ma_20: pack.ma20,
    ma_50: pack.ma50,
    ma_200: pack.ma200,
    ma_slope20: pack.slope20,
    ma_slope50: pack.slope50,
    ma_slope200: pack.slope200,
    ma_dist20: pack.dist20,
    ma_dist50: pack.dist50,
    ma_dist200: pack.dist200,
    ma_cross50_200: pack.cross50_200,
    ma_alignment: pack.alignment === "BULL" ? 1 : pack.alignment === "BEAR" ? -1 : 0,
  };
}
