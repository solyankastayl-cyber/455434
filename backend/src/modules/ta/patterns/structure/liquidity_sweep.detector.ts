/**
 * Phase R1: Liquidity Sweep Detector (fake breakout)
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectLiquiditySweep(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 3; i < candles.length; i++) {
    const prevHigh = candles[i - 2].h;
    const prevLow = candles[i - 2].l;
    const candle = candles[i];
    
    // Sweep up (took highs but closed back below)
    if (candle.h > prevHigh && candle.c < prevHigh) {
      results.push({
        type: 'liquidity_sweep',
        direction: 'BEAR',
        confidence: 0.70,
        startIndex: i - 2,
        endIndex: i,
        priceLevels: [prevHigh],
      });
    }
    
    // Sweep down (took lows but closed back above)
    if (candle.l < prevLow && candle.c > prevLow) {
      results.push({
        type: 'liquidity_sweep',
        direction: 'BULL',
        confidence: 0.70,
        startIndex: i - 2,
        endIndex: i,
        priceLevels: [prevLow],
      });
    }
  }
  
  return results;
}
