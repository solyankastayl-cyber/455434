/**
 * Phase R1: Flip Detector (support becomes resistance)
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectFlip(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 5; i < candles.length; i++) {
    const prevLow = candles[i - 3].l;
    const prevHigh = candles[i - 3].h;
    const breakCandle = candles[i];
    
    // Support becomes resistance (bearish flip)
    if (breakCandle.c < prevLow && candles[i - 1].c > prevLow) {
      results.push({
        type: 'flip',
        direction: 'BEAR',
        confidence: 0.60,
        startIndex: i - 3,
        endIndex: i,
        priceLevels: [prevLow],
      });
    }
    
    // Resistance becomes support (bullish flip)
    if (breakCandle.c > prevHigh && candles[i - 1].c < prevHigh) {
      results.push({
        type: 'flip',
        direction: 'BULL',
        confidence: 0.60,
        startIndex: i - 3,
        endIndex: i,
        priceLevels: [prevHigh],
      });
    }
  }
  
  return results;
}
