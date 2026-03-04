/**
 * Phase R1: Support Detector
 * Detects support levels from swing lows cluster
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { findSwingLows } from '../utils/swing_points.js';

export function detectSupport(input: PatternInput): PatternResult[] {
  const lows = findSwingLows(input.candles);
  const results: PatternResult[] = [];
  
  for (let i = 0; i < lows.length - 2; i++) {
    const a = lows[i];
    const b = lows[i + 1];
    const c = lows[i + 2];
    
    const tolerance = a.price * 0.002;
    
    if (
      Math.abs(a.price - b.price) < tolerance &&
      Math.abs(a.price - c.price) < tolerance
    ) {
      results.push({
        type: 'support',
        direction: 'BULL',
        confidence: 0.70,
        startIndex: a.index,
        endIndex: c.index,
        priceLevels: [a.price],
      });
    }
  }
  
  return results;
}
