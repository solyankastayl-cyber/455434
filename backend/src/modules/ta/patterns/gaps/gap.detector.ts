/**
 * Phase R10.A: Gap Detector
 * Detects gap_up and gap_down patterns
 */

import { PatternResult } from '../utils/pattern_types.js';
import { hasGapUp, hasGapDown, gapSizePct, Candle } from './gaps_utils.js';

export function detectGaps(candles: Candle[], minGapPct = 0.002): PatternResult[] {
  const results: PatternResult[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    
    const gapPct = gapSizePct(prev, curr);
    if (gapPct < minGapPct) continue;
    
    // Gap confidence based on size
    const conf = Math.min(0.85, 0.65 + gapPct * 10);
    
    if (hasGapUp(prev, curr)) {
      results.push({
        type: 'GAP_UP',
        direction: 'BULL',
        confidence: conf,
        startIndex: i - 1,
        endIndex: i,
        priceLevels: [prev.h, curr.l],
        meta: { gapPct, gapSize: curr.l - prev.h },
      });
    }
    
    if (hasGapDown(prev, curr)) {
      results.push({
        type: 'GAP_DOWN',
        direction: 'BEAR',
        confidence: conf,
        startIndex: i - 1,
        endIndex: i,
        priceLevels: [curr.h, prev.l],
        meta: { gapPct, gapSize: prev.l - curr.h },
      });
    }
  }
  
  return results;
}
