/**
 * Phase R4: Triple Bottom Detector
 * Detects triple bottom reversal pattern (3 troughs at similar levels)
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { findSwingLows } from '../utils/swing_points.js';
import { withinPct } from '../utils/level_utils.js';

export function detectTripleBottom(input: PatternInput): PatternResult[] {
  const lows = findSwingLows(input.candles, 5);
  const results: PatternResult[] = [];
  
  if (lows.length < 3) return [];
  
  for (let i = 0; i < lows.length - 2; i++) {
    const l1 = lows[i];
    const l2 = lows[i + 1];
    const l3 = lows[i + 2];
    
    // Check spacing
    const span1 = l2.index - l1.index;
    const span2 = l3.index - l2.index;
    if (span1 < 5 || span2 < 5 || span1 > 60 || span2 > 60) continue;
    
    // Check similar depths (within 1.5%)
    if (!withinPct(l1.price, l2.price, 0.015)) continue;
    if (!withinPct(l1.price, l3.price, 0.015)) continue;
    
    // Find peaks between troughs
    const peak1 = findHighestBetween(input.candles, l1.index, l2.index);
    const peak2 = findHighestBetween(input.candles, l2.index, l3.index);
    
    if (!peak1 || !peak2) continue;
    
    // Peaks should be at similar levels
    if (!withinPct(peak1, peak2, 0.02)) continue;
    
    // Peaks should be notably higher than troughs
    const avgTrough = (l1.price + l2.price + l3.price) / 3;
    const avgPeak = (peak1 + peak2) / 2;
    const depth = (avgPeak - avgTrough) / avgPeak;
    
    if (depth < 0.02) continue;
    
    const conf = Math.min(0.90, 0.55 + 0.15 * (1 - Math.abs(l1.price - l3.price) / l1.price * 10) + 0.10 * depth);
    
    results.push({
      type: 'TRIPLE_BOTTOM',
      direction: 'BULL',
      confidence: conf,
      startIndex: l1.index,
      endIndex: l3.index,
      priceLevels: [avgTrough, avgPeak],
      meta: {
        troughs: [l1.price, l2.price, l3.price],
        neckline: avgPeak,
      },
    });
  }
  
  return results;
}

function findHighestBetween(candles: { h: number }[], start: number, end: number): number | null {
  if (start >= end) return null;
  let highest = -Infinity;
  for (let i = start + 1; i < end; i++) {
    if (candles[i].h > highest) highest = candles[i].h;
  }
  return highest === -Infinity ? null : highest;
}
