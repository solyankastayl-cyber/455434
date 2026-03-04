/**
 * Phase R4: Rounding Bottom Detector
 * Detects rounding bottom (cup) reversal pattern
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';

export function detectRoundingBottom(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  const minBars = 30;
  if (candles.length < minBars) return [];
  
  for (const window of [30, 45, 60, 80]) {
    if (candles.length < window) continue;
    
    const start = candles.length - window;
    const segment = candles.slice(start);
    
    // Find the lowest point (nadir)
    let nadirIdx = 0;
    let nadirPrice = segment[0].l;
    for (let i = 1; i < segment.length; i++) {
      if (segment[i].l < nadirPrice) {
        nadirPrice = segment[i].l;
        nadirIdx = i;
      }
    }
    
    // Nadir should be roughly in the middle
    const nadirRatio = nadirIdx / segment.length;
    if (nadirRatio < 0.25 || nadirRatio > 0.75) continue;
    
    const leftHalf = segment.slice(0, nadirIdx);
    const rightHalf = segment.slice(nadirIdx);
    
    if (leftHalf.length < 5 || rightHalf.length < 5) continue;
    
    // Left half should be falling
    const leftStart = leftHalf[0].c;
    const leftEnd = leftHalf[leftHalf.length - 1].c;
    const leftFall = (leftStart - leftEnd) / leftStart;
    
    // Right half should be rising
    const rightStart = rightHalf[0].c;
    const rightEnd = rightHalf[rightHalf.length - 1].c;
    const rightRise = (rightEnd - rightStart) / rightStart;
    
    if (leftFall < 0.02 || rightRise < 0.02) continue;
    
    const smoothness = calculateSmoothness(segment);
    if (smoothness < 0.5) continue;
    
    const conf = Math.min(0.85, 0.50 + 0.15 * smoothness + 0.10 * Math.min(leftFall, rightRise) * 5);
    
    results.push({
      type: 'ROUNDING_BOTTOM',
      direction: 'BULL',
      confidence: conf,
      startIndex: start,
      endIndex: candles.length - 1,
      priceLevels: [nadirPrice, Math.max(segment[0].h, segment[segment.length - 1].h)],
      meta: {
        nadirIndex: start + nadirIdx,
        window,
        smoothness,
      },
    });
  }
  
  return results;
}

function calculateSmoothness(candles: { c: number }[]): number {
  if (candles.length < 3) return 0;
  
  let volatility = 0;
  let totalChange = 0;
  
  for (let i = 1; i < candles.length; i++) {
    const change = Math.abs(candles[i].c - candles[i - 1].c) / candles[i - 1].c;
    volatility += change;
    totalChange += candles[i].c - candles[i - 1].c;
  }
  
  const avgMove = Math.abs(totalChange) / candles.length;
  const avgVol = volatility / candles.length;
  
  return avgVol > 0 ? Math.min(1, avgMove / avgVol / 2) : 0;
}
