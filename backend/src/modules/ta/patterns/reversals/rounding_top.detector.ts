/**
 * Phase R4: Rounding Top Detector
 * Detects rounding top (cup/saucer top) reversal pattern
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectRoundingTop(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  // Need at least 30 bars for a valid rounding top
  const minBars = 30;
  if (candles.length < minBars) return [];
  
  // Try different window sizes
  for (const window of [30, 45, 60, 80]) {
    if (candles.length < window) continue;
    
    const start = candles.length - window;
    const segment = candles.slice(start);
    
    // Find the highest point (apex)
    let apexIdx = 0;
    let apexPrice = segment[0].h;
    for (let i = 1; i < segment.length; i++) {
      if (segment[i].h > apexPrice) {
        apexPrice = segment[i].h;
        apexIdx = i;
      }
    }
    
    // Apex should be roughly in the middle (25%-75% of pattern)
    const apexRatio = apexIdx / segment.length;
    if (apexRatio < 0.25 || apexRatio > 0.75) continue;
    
    // Check for curved shape: prices rise then fall
    const leftHalf = segment.slice(0, apexIdx);
    const rightHalf = segment.slice(apexIdx);
    
    if (leftHalf.length < 5 || rightHalf.length < 5) continue;
    
    // Left half should be rising
    const leftStart = leftHalf[0].c;
    const leftEnd = leftHalf[leftHalf.length - 1].c;
    const leftRise = (leftEnd - leftStart) / leftStart;
    
    // Right half should be falling
    const rightStart = rightHalf[0].c;
    const rightEnd = rightHalf[rightHalf.length - 1].c;
    const rightFall = (rightStart - rightEnd) / rightStart;
    
    if (leftRise < 0.02 || rightFall < 0.02) continue;
    
    // Check for smoothness (low volatility in the curve)
    const smoothness = calculateSmoothness(segment);
    if (smoothness < 0.5) continue;
    
    const conf = Math.min(0.85, 0.50 + 0.15 * smoothness + 0.10 * Math.min(leftRise, rightFall) * 5);
    
    results.push({
      type: 'ROUNDING_TOP',
      direction: 'BEAR',
      confidence: conf,
      startIndex: start,
      endIndex: candles.length - 1,
      priceLevels: [apexPrice, Math.min(segment[0].l, segment[segment.length - 1].l)],
      meta: {
        apexIndex: start + apexIdx,
        window,
        smoothness,
      },
    });
  }
  
  return results;
}

function calculateSmoothness(candles: { c: number }[]): number {
  if (candles.length < 3) return 0;
  
  let totalChange = 0;
  let volatility = 0;
  
  for (let i = 1; i < candles.length; i++) {
    const change = Math.abs(candles[i].c - candles[i - 1].c) / candles[i - 1].c;
    volatility += change;
    totalChange += candles[i].c - candles[i - 1].c;
  }
  
  const avgMove = Math.abs(totalChange) / candles.length;
  const avgVol = volatility / candles.length;
  
  // Higher smoothness means more consistent moves
  return avgVol > 0 ? Math.min(1, avgMove / avgVol / 2) : 0;
}
