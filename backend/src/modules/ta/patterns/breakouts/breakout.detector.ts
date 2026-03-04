/**
 * Phase R2: Breakout Detector
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectBreakout(input: PatternInput, levels: number[]): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    
    for (const level of levels) {
      // Bullish breakout
      if (prev.c < level && curr.c > level) {
        results.push({
          type: 'breakout',
          direction: 'BULL',
          confidence: 0.75,
          startIndex: i - 1,
          endIndex: i,
          priceLevels: [level],
        });
      }
      
      // Bearish breakout
      if (prev.c > level && curr.c < level) {
        results.push({
          type: 'breakout',
          direction: 'BEAR',
          confidence: 0.75,
          startIndex: i - 1,
          endIndex: i,
          priceLevels: [level],
        });
      }
    }
  }
  
  return results;
}
