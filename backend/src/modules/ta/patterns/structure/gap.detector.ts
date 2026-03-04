/**
 * Phase R1: Gap Detector
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectGap(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    
    // Gap up
    if (curr.l > prev.h) {
      const gapSize = (curr.l - prev.h) / prev.h;
      if (gapSize > 0.005) {
        results.push({
          type: 'gap_up',
          direction: 'BULL',
          confidence: 0.60 + Math.min(0.2, gapSize * 5),
          startIndex: i - 1,
          endIndex: i,
          priceLevels: [prev.h, curr.l],
        });
      }
    }
    
    // Gap down
    if (curr.h < prev.l) {
      const gapSize = (prev.l - curr.h) / prev.l;
      if (gapSize > 0.005) {
        results.push({
          type: 'gap_down',
          direction: 'BEAR',
          confidence: 0.60 + Math.min(0.2, gapSize * 5),
          startIndex: i - 1,
          endIndex: i,
          priceLevels: [curr.h, prev.l],
        });
      }
    }
  }
  
  return results;
}
