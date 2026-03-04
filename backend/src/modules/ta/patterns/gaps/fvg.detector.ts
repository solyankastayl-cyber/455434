/**
 * Phase R10.A: Fair Value Gap (FVG) Detector
 * 3-candle imbalance pattern
 */

import { PatternResult } from '../utils/pattern_types.js';
import { hasFVG, Candle } from './gaps_utils.js';

export function detectFVG(candles: Candle[], minPct = 0.0015): PatternResult[] {
  const results: PatternResult[] = [];
  
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const b = candles[i - 1];
    const c = candles[i];
    
    const fvg = hasFVG(a, b, c);
    if (!fvg) continue;
    
    const gapPct = fvg.gap / Math.max(1e-9, b.c);
    if (gapPct < minPct) continue;
    
    const conf = Math.min(0.82, 0.68 + gapPct * 5);
    
    if (fvg.type === 'BULL') {
      results.push({
        type: 'FAIR_VALUE_GAP_BULL',
        direction: 'BULL',
        confidence: conf,
        startIndex: i - 2,
        endIndex: i,
        priceLevels: [a.h, c.l],
        meta: { fvgSize: fvg.gap, fvgPct: gapPct },
      });
    } else {
      results.push({
        type: 'FAIR_VALUE_GAP_BEAR',
        direction: 'BEAR',
        confidence: conf,
        startIndex: i - 2,
        endIndex: i,
        priceLevels: [c.h, a.l],
        meta: { fvgSize: fvg.gap, fvgPct: gapPct },
      });
    }
  }
  
  return results;
}
