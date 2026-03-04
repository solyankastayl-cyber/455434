/**
 * Phase R1: Range Detector (sideways market)
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectRange(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const window = 20;
  const results: PatternResult[] = [];
  
  for (let i = window; i < candles.length; i++) {
    const slice = candles.slice(i - window, i);
    
    const high = Math.max(...slice.map(c => c.h));
    const low = Math.min(...slice.map(c => c.l));
    const width = (high - low) / high;
    
    if (width < 0.03) {
      results.push({
        type: 'range',
        direction: 'NEUTRAL',
        confidence: 0.65,
        startIndex: i - window,
        endIndex: i,
        priceLevels: [low, high],
      });
    }
  }
  
  return results;
}
