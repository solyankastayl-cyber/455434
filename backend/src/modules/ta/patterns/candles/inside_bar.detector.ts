/**
 * Phase R6: Inside Bar Detector
 * Price consolidation pattern
 */

import { PatternInput, PatternResult, Candle } from '../utils/pattern_types.js';

export function detectInsideBar(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  if (candles.length < 2) return [];
  
  for (let i = 1; i < candles.length; i++) {
    const mother = candles[i - 1];
    const inside = candles[i];
    
    // Inside bar: current bar's high/low are within previous bar's range
    if (inside.h < mother.h && inside.l > mother.l) {
      // Direction determined by breakout (context)
      const direction = determineBreakoutDirection(candles, i);
      
      // Confidence based on how "inside" the bar is
      const range = mother.h - mother.l;
      const insideRange = inside.h - inside.l;
      const compression = 1 - (insideRange / range);
      
      const conf = Math.min(0.80, 0.50 + 0.20 * compression);
      
      results.push({
        type: 'CANDLE_INSIDE',
        direction,
        confidence: conf,
        startIndex: i - 1,
        endIndex: i,
        priceLevels: [mother.h, mother.l],
        meta: {
          motherRange: range,
          insideRange,
          compression,
        },
      });
    }
  }
  
  return results;
}

function determineBreakoutDirection(candles: Candle[], idx: number): 'BULL' | 'BEAR' | 'NEUTRAL' {
  // Look at next candle if available
  if (idx + 1 < candles.length) {
    const mother = candles[idx - 1];
    const next = candles[idx + 1];
    
    if (next.c > mother.h) return 'BULL';
    if (next.c < mother.l) return 'BEAR';
  }
  
  // Otherwise use prior trend
  if (idx < 5) return 'NEUTRAL';
  
  const priorClose = candles[idx - 5].c;
  const currentClose = candles[idx].c;
  const trend = (currentClose - priorClose) / priorClose;
  
  if (trend > 0.02) return 'BULL';
  if (trend < -0.02) return 'BEAR';
  return 'NEUTRAL';
}
