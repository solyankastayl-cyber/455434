/**
 * Phase R1: Order Block Detector
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectOrderBlock(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 3; i < candles.length; i++) {
    const base = candles[i - 2];
    const impulse = candles[i];
    
    const move = (impulse.c - impulse.o) / impulse.o;
    
    // Bullish order block
    if (move > 0.015) {
      results.push({
        type: 'orderblock',
        direction: 'BULL',
        confidence: 0.65 + Math.min(0.2, Math.abs(move) * 5),
        startIndex: i - 2,
        endIndex: i,
        priceLevels: [base.l, base.h],
      });
    }
    
    // Bearish order block
    if (move < -0.015) {
      results.push({
        type: 'orderblock',
        direction: 'BEAR',
        confidence: 0.65 + Math.min(0.2, Math.abs(move) * 5),
        startIndex: i - 2,
        endIndex: i,
        priceLevels: [base.l, base.h],
      });
    }
  }
  
  return results;
}
