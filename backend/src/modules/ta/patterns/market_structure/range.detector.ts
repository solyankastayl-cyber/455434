/**
 * Phase R7: Range Box Detector
 * Detects consolidation / ranging market structure
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { findSwingHighs, findSwingLows } from '../utils/swing_points.js';

export function detectRangeBox(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  if (candles.length < 15) return [];
  
  const highs = findSwingHighs(candles, 3);
  const lows = findSwingLows(candles, 3);
  
  if (highs.length < 2 || lows.length < 2) return [];
  
  // Find potential range boundaries
  const recentHighs = highs.slice(-5);
  const recentLows = lows.slice(-5);
  
  if (recentHighs.length < 2 || recentLows.length < 2) return [];
  
  // Calculate range bounds
  const avgHigh = recentHighs.reduce((s, h) => s + h.price, 0) / recentHighs.length;
  const avgLow = recentLows.reduce((s, l) => s + l.price, 0) / recentLows.length;
  
  // Check if highs and lows are clustered (range-bound)
  const highVariance = calculateVariance(recentHighs.map(h => h.price));
  const lowVariance = calculateVariance(recentLows.map(l => l.price));
  
  const rangeSize = avgHigh - avgLow;
  const relativeVariance = (highVariance + lowVariance) / (rangeSize * rangeSize);
  
  // Low variance means tight range
  if (relativeVariance > 0.1) return []; // Too much variance
  
  // Range should be meaningful (not too tight)
  const rangePercent = rangeSize / avgLow;
  if (rangePercent < 0.02 || rangePercent > 0.15) return [];
  
  const startIdx = Math.min(recentHighs[0].index, recentLows[0].index);
  const endIdx = Math.max(
    recentHighs[recentHighs.length - 1].index,
    recentLows[recentLows.length - 1].index
  );
  
  const conf = Math.min(0.85, 0.55 + 0.20 * (1 - relativeVariance * 5));
  
  results.push({
    type: 'RANGE_BOX',
    direction: 'NEUTRAL',
    confidence: conf,
    startIndex: startIdx,
    endIndex: endIdx,
    priceLevels: [avgHigh, avgLow],
    meta: {
      rangeHigh: avgHigh,
      rangeLow: avgLow,
      rangePercent,
      touches: recentHighs.length + recentLows.length,
    },
  });
  
  return results;
}

function calculateVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return variance;
}
