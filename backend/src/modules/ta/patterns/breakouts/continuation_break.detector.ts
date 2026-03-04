/**
 * Phase R2: Continuation Break Detector
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectContinuationBreak(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 3; i < candles.length; i++) {
    const a = candles[i - 3];
    const b = candles[i - 2];
    const c = candles[i - 1];
    const d = candles[i];
    
    // Bullish continuation
    if (a.c < b.c && b.c < c.c && d.c > c.h) {
      results.push({
        type: 'continuation_break',
        direction: 'BULL',
        confidence: 0.70,
        startIndex: i - 3,
        endIndex: i,
      });
    }
    
    // Bearish continuation
    if (a.c > b.c && b.c > c.c && d.c < c.l) {
      results.push({
        type: 'continuation_break',
        direction: 'BEAR',
        confidence: 0.70,
        startIndex: i - 3,
        endIndex: i,
      });
    }
  }
  
  return results;
}
