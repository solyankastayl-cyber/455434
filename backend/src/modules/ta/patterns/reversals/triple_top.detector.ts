/**
 * Phase R4: Triple Top Detector
 * Detects triple top reversal pattern (3 peaks at similar levels)
 */

import { PatternInput, PatternResult, Pivot } from '../utils/pattern_types.js';
import { findSwingHighs } from '../utils/swing_points.js';
import { withinPct } from '../utils/level_utils.js';

export function detectTripleTop(input: PatternInput): PatternResult[] {
  const highs = findSwingHighs(input.candles, 5);
  const results: PatternResult[] = [];
  
  if (highs.length < 3) return [];
  
  for (let i = 0; i < highs.length - 2; i++) {
    const h1 = highs[i];
    const h2 = highs[i + 1];
    const h3 = highs[i + 2];
    
    // Check spacing (not too close, not too far)
    const span1 = h2.index - h1.index;
    const span2 = h3.index - h2.index;
    if (span1 < 5 || span2 < 5 || span1 > 60 || span2 > 60) continue;
    
    // Check similar heights (within 1.5%)
    if (!withinPct(h1.price, h2.price, 0.015)) continue;
    if (!withinPct(h1.price, h3.price, 0.015)) continue;
    
    // Find valleys between peaks
    const valley1 = findLowestBetween(input.candles, h1.index, h2.index);
    const valley2 = findLowestBetween(input.candles, h2.index, h3.index);
    
    if (!valley1 || !valley2) continue;
    
    // Valleys should be at similar levels
    if (!withinPct(valley1, valley2, 0.02)) continue;
    
    // Peaks should be notably higher than valleys
    const avgPeak = (h1.price + h2.price + h3.price) / 3;
    const avgValley = (valley1 + valley2) / 2;
    const depth = (avgPeak - avgValley) / avgPeak;
    
    if (depth < 0.02) continue;
    
    const conf = Math.min(0.90, 0.55 + 0.15 * (1 - Math.abs(h1.price - h3.price) / h1.price * 10) + 0.10 * depth);
    
    results.push({
      type: 'TRIPLE_TOP',
      direction: 'BEAR',
      confidence: conf,
      startIndex: h1.index,
      endIndex: h3.index,
      priceLevels: [avgPeak, avgValley],
      meta: {
        peaks: [h1.price, h2.price, h3.price],
        neckline: avgValley,
      },
    });
  }
  
  return results;
}

function findLowestBetween(candles: { l: number }[], start: number, end: number): number | null {
  if (start >= end) return null;
  let lowest = Infinity;
  for (let i = start + 1; i < end; i++) {
    if (candles[i].l < lowest) lowest = candles[i].l;
  }
  return lowest === Infinity ? null : lowest;
}
