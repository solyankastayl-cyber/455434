/**
 * Phase R2: False Breakout Detector
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectFalseBreakout(input: PatternInput, levels: number[]): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 2; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    
    for (const level of levels) {
      // False bullish breakout (broke up but closed back below)
      if (prev.h > level && prev.c > level && curr.c < level) {
        results.push({
          type: 'false_breakout',
          direction: 'BEAR',
          confidence: 0.80,
          startIndex: i - 1,
          endIndex: i,
          priceLevels: [level],
        });
      }
      
      // False bearish breakout (broke down but closed back above)
      if (prev.l < level && prev.c < level && curr.c > level) {
        results.push({
          type: 'false_breakout',
          direction: 'BULL',
          confidence: 0.80,
          startIndex: i - 1,
          endIndex: i,
          priceLevels: [level],
        });
      }
    }
  }
  
  return results;
}
