/**
 * Phase R2: Retest Detector
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectRetest(input: PatternInput, levels: number[]): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 2; i < candles.length; i++) {
    const breakout = candles[i - 2];
    const retest = candles[i - 1];
    const confirm = candles[i];
    
    for (const level of levels) {
      // Bullish retest (broke up, came back to level, continued up)
      if (breakout.c > level && retest.l <= level && confirm.c > level) {
        results.push({
          type: 'retest',
          direction: 'BULL',
          confidence: 0.85,
          startIndex: i - 2,
          endIndex: i,
          priceLevels: [level],
        });
      }
      
      // Bearish retest
      if (breakout.c < level && retest.h >= level && confirm.c < level) {
        results.push({
          type: 'retest',
          direction: 'BEAR',
          confidence: 0.85,
          startIndex: i - 2,
          endIndex: i,
          priceLevels: [level],
        });
      }
    }
  }
  
  return results;
}
