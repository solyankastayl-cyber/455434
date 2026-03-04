/**
 * Phase R1: Pivot Detector
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectPivot(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 3; i < candles.length - 3; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];
    
    // Bullish pivot: bearish then bullish continuation
    if (prev.c < prev.o && curr.c > curr.o && next.c > next.o) {
      results.push({
        type: 'pivot',
        direction: 'BULL',
        confidence: 0.60,
        startIndex: i - 1,
        endIndex: i + 1,
        priceLevels: [curr.l],
      });
    }
    
    // Bearish pivot: bullish then bearish continuation
    if (prev.c > prev.o && curr.c < curr.o && next.c < next.o) {
      results.push({
        type: 'pivot',
        direction: 'BEAR',
        confidence: 0.60,
        startIndex: i - 1,
        endIndex: i + 1,
        priceLevels: [curr.h],
      });
    }
  }
  
  return results;
}
