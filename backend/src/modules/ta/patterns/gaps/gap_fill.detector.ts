/**
 * Phase R10.A: Gap Fill Detector
 * Detects when price returns to fill a gap
 */

import { PatternResult } from '../utils/pattern_types.js';
import { hasGapUp, hasGapDown, Candle } from './gaps_utils.js';

export function detectGapFill(candles: Candle[], lookahead = 10): PatternResult[] {
  const results: PatternResult[] = [];
  
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    
    // Gap up: look for fill (price returns to prev.h)
    if (hasGapUp(prev, curr)) {
      const gapTop = curr.l;
      const gapBottom = prev.h;
      
      for (let k = i + 1; k <= Math.min(candles.length - 1, i + lookahead); k++) {
        if (candles[k].l <= gapBottom) {
          results.push({
            type: 'GAP_FILL',
            direction: 'BEAR',
            confidence: 0.70,
            startIndex: i - 1,
            endIndex: k,
            priceLevels: [gapTop, gapBottom],
            meta: { fillBars: k - i, gapType: 'up' },
          });
          break;
        }
      }
    }
    
    // Gap down: look for fill (price returns to prev.l)
    if (hasGapDown(prev, curr)) {
      const gapTop = prev.l;
      const gapBottom = curr.h;
      
      for (let k = i + 1; k <= Math.min(candles.length - 1, i + lookahead); k++) {
        if (candles[k].h >= gapTop) {
          results.push({
            type: 'GAP_FILL',
            direction: 'BULL',
            confidence: 0.70,
            startIndex: i - 1,
            endIndex: k,
            priceLevels: [gapTop, gapBottom],
            meta: { fillBars: k - i, gapType: 'down' },
          });
          break;
        }
      }
    }
  }
  
  return results;
}
