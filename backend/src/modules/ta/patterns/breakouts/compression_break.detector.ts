/**
 * Phase R2: Compression Break Detector
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { candleRange } from '../utils/candle_utils.js';

export function detectCompressionBreak(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  const window = 5;
  
  for (let i = window; i < candles.length; i++) {
    const slice = candles.slice(i - window, i);
    const ranges = slice.map(candleRange);
    const avg = ranges.reduce((a, b) => a + b) / ranges.length;
    
    const last = candles[i];
    const lastRange = candleRange(last);
    
    // Compression followed by expansion
    if (avg < 0.01 && lastRange > avg * 3) {
      results.push({
        type: 'compression_break',
        direction: last.c > last.o ? 'BULL' : 'BEAR',
        confidence: 0.80,
        startIndex: i - window,
        endIndex: i,
      });
    }
  }
  
  return results;
}
