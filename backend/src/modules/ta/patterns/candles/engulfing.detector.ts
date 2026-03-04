/**
 * Phase R6: Engulfing Pattern Detector
 * Two-candle reversal pattern
 */

import { PatternInput, PatternResult, Candle } from '../utils/pattern_types.js';
import { body, isBullish, isBearish } from '../utils/candle_utils.js';

export function detectEngulfing(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  if (candles.length < 2) return [];
  
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    
    // Bullish Engulfing: bearish candle followed by larger bullish candle
    if (isBearish(prev) && isBullish(curr)) {
      const prevBody = body(prev);
      const currBody = body(curr);
      
      // Current body should engulf previous body
      if (curr.o <= prev.c && curr.c >= prev.o && currBody > prevBody) {
        const conf = Math.min(0.85, 0.55 + 0.15 * (currBody / prevBody - 1));
        
        results.push({
          type: 'CANDLE_ENGULF_BULL',
          direction: 'BULL',
          confidence: conf,
          startIndex: i - 1,
          endIndex: i,
          priceLevels: [prev.l, curr.c],
        });
      }
    }
    
    // Bearish Engulfing: bullish candle followed by larger bearish candle
    if (isBullish(prev) && isBearish(curr)) {
      const prevBody = body(prev);
      const currBody = body(curr);
      
      if (curr.o >= prev.c && curr.c <= prev.o && currBody > prevBody) {
        const conf = Math.min(0.85, 0.55 + 0.15 * (currBody / prevBody - 1));
        
        results.push({
          type: 'CANDLE_ENGULF_BEAR',
          direction: 'BEAR',
          confidence: conf,
          startIndex: i - 1,
          endIndex: i,
          priceLevels: [prev.h, curr.c],
        });
      }
    }
  }
  
  return results;
}
