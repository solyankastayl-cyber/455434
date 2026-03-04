/**
 * Phase R7: Trend Shift Detector
 * Detects overall market structure trend changes
 */

import { PatternInput, PatternResult, Pivot } from '../utils/pattern_types.js';
import { findSwingHighs, findSwingLows } from '../utils/swing_points.js';

export function detectTrendShift(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  if (candles.length < 20) return [];
  
  const highs = findSwingHighs(candles, 5);
  const lows = findSwingLows(candles, 5);
  
  if (highs.length < 3 || lows.length < 3) return [];
  
  // Analyze structure in two halves
  const midpoint = Math.floor(candles.length / 2);
  
  const firstHalfHighs = highs.filter(h => h.index < midpoint);
  const secondHalfHighs = highs.filter(h => h.index >= midpoint);
  const firstHalfLows = lows.filter(l => l.index < midpoint);
  const secondHalfLows = lows.filter(l => l.index >= midpoint);
  
  if (firstHalfHighs.length < 2 || secondHalfHighs.length < 1) return [];
  if (firstHalfLows.length < 2 || secondHalfLows.length < 1) return [];
  
  // Detect trend in first half
  const firstTrend = detectTrend(firstHalfHighs, firstHalfLows);
  
  // Detect trend in second half
  const secondTrend = detectTrend(secondHalfHighs, secondHalfLows);
  
  // If trends differ, we have a shift
  if (firstTrend !== secondTrend && firstTrend !== 'range' && secondTrend !== 'range') {
    const shiftPoint = findShiftPoint(candles, highs, lows, midpoint);
    
    if (secondTrend === 'up') {
      results.push({
        type: 'TREND_UP',
        direction: 'BULL',
        confidence: 0.75,
        startIndex: shiftPoint,
        endIndex: candles.length - 1,
        meta: {
          priorTrend: firstTrend,
          newTrend: secondTrend,
          shiftType: 'reversal',
        },
      });
    } else if (secondTrend === 'down') {
      results.push({
        type: 'TREND_DOWN',
        direction: 'BEAR',
        confidence: 0.75,
        startIndex: shiftPoint,
        endIndex: candles.length - 1,
        meta: {
          priorTrend: firstTrend,
          newTrend: secondTrend,
          shiftType: 'reversal',
        },
      });
    }
  }
  
  return results;
}

function detectTrend(highs: Pivot[], lows: Pivot[]): 'up' | 'down' | 'range' {
  if (highs.length < 2 || lows.length < 2) return 'range';
  
  // Check highs pattern
  let higherHighs = 0;
  for (let i = 1; i < highs.length; i++) {
    if (highs[i].price > highs[i - 1].price) higherHighs++;
  }
  
  // Check lows pattern
  let higherLows = 0;
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].price > lows[i - 1].price) higherLows++;
  }
  
  const highsUp = higherHighs > (highs.length - 1) * 0.6;
  const lowsUp = higherLows > (lows.length - 1) * 0.6;
  const highsDown = higherHighs < (highs.length - 1) * 0.4;
  const lowsDown = higherLows < (lows.length - 1) * 0.4;
  
  if (highsUp && lowsUp) return 'up';
  if (highsDown && lowsDown) return 'down';
  return 'range';
}

function findShiftPoint(
  candles: { c: number }[],
  highs: Pivot[],
  lows: Pivot[],
  midpoint: number
): number {
  // Find the pivot closest to midpoint
  const allPivots = [...highs, ...lows].sort((a, b) => a.index - b.index);
  
  let closest = allPivots[0]?.index || midpoint;
  let minDist = Math.abs(closest - midpoint);
  
  for (const p of allPivots) {
    const dist = Math.abs(p.index - midpoint);
    if (dist < minDist) {
      minDist = dist;
      closest = p.index;
    }
  }
  
  return closest;
}
