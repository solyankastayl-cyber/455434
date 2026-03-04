/**
 * Phase R1: Resistance Detector
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { findSwingHighs } from '../utils/swing_points.js';

export function detectResistance(input: PatternInput): PatternResult[] {
  const highs = findSwingHighs(input.candles);
  const results: PatternResult[] = [];
  
  for (let i = 0; i < highs.length - 2; i++) {
    const a = highs[i];
    const b = highs[i + 1];
    const c = highs[i + 2];
    
    const tolerance = a.price * 0.002;
    
    if (
      Math.abs(a.price - b.price) < tolerance &&
      Math.abs(a.price - c.price) < tolerance
    ) {
      results.push({
        type: 'resistance',
        direction: 'BEAR',
        confidence: 0.70,
        startIndex: a.index,
        endIndex: c.index,
        priceLevels: [a.price],
      });
    }
  }
  
  return results;
}
