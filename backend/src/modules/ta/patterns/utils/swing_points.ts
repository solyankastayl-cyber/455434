/**
 * Phase R: Swing Points Utility
 * Find local highs and lows in price data
 */

import { Candle, Pivot } from './pattern_types.js';

/**
 * Find swing highs (local maxima)
 */
export function findSwingHighs(candles: Candle[], lookback = 3): Pivot[] {
  const swings: Pivot[] = [];
  
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].h <= candles[i - j].h) isHigh = false;
      if (candles[i].h <= candles[i + j].h) isHigh = false;
    }
    
    if (isHigh) {
      swings.push({
        index: i,
        price: candles[i].h,
        kind: 'HIGH',
        strength: lookback,
      });
    }
  }
  
  return swings;
}

/**
 * Find swing lows (local minima)
 */
export function findSwingLows(candles: Candle[], lookback = 3): Pivot[] {
  const swings: Pivot[] = [];
  
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isLow = true;
    
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].l >= candles[i - j].l) isLow = false;
      if (candles[i].l >= candles[i + j].l) isLow = false;
    }
    
    if (isLow) {
      swings.push({
        index: i,
        price: candles[i].l,
        kind: 'LOW',
        strength: lookback,
      });
    }
  }
  
  return swings;
}

/**
 * Find all pivots (highs and lows)
 */
export function findAllPivots(candles: Candle[], lookback = 3): Pivot[] {
  const highs = findSwingHighs(candles, lookback);
  const lows = findSwingLows(candles, lookback);
  
  return [...highs, ...lows].sort((a, b) => a.index - b.index);
}

/**
 * Split pivots into highs and lows
 */
export function splitPivots(pivots: Pivot[]): { highs: Pivot[]; lows: Pivot[] } {
  return {
    highs: pivots.filter(p => p.kind === 'HIGH'),
    lows: pivots.filter(p => p.kind === 'LOW'),
  };
}
