/**
 * Phase R7: Change of Character (CHOCH) Detector
 * Market structure pattern: trend reversal signal
 * 
 * CHOCH Bull: In downtrend, price breaks above last lower high (structure shift up)
 * CHOCH Bear: In uptrend, price breaks below last higher low (structure shift down)
 */

import { PatternInput, PatternResult, Pivot, Candle } from '../utils/pattern_types.js';
import { findSwingHighs, findSwingLows } from '../utils/swing_points.js';

export function detectCHOCH(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  const highs = findSwingHighs(candles, 3);
  const lows = findSwingLows(candles, 3);
  
  if (highs.length < 3 || lows.length < 3) return [];
  
  // CHOCH Bull: In downtrend (lower highs), price breaks above a lower high
  // This signals potential trend reversal to uptrend
  for (let i = 2; i < highs.length; i++) {
    const h1 = highs[i - 2];
    const h2 = highs[i - 1];
    const h3 = highs[i];
    
    // Confirm downtrend: descending highs
    if (h2.price >= h1.price) continue;
    
    // CHOCH: h3 breaks above h2 (breaking the lower high sequence)
    if (h3.price > h2.price) {
      // Find the break candle
      const breakIdx = findBreakCandleAbove(candles, h2.price, h2.index, h3.index);
      if (breakIdx === -1) continue;
      
      // Validate with lows (should have been making lower lows)
      const relevantLows = lows.filter(l => l.index > h1.index && l.index < h3.index);
      const isDowntrend = isDescending(relevantLows);
      if (!isDowntrend) continue;
      
      const conf = calculateCHOCHConfidence(candles, breakIdx, h2.price, 'bull');
      
      results.push({
        type: 'CHOCH_BULL',
        direction: 'BULL',
        confidence: conf,
        startIndex: h2.index,
        endIndex: breakIdx,
        priceLevels: [h2.price],
        meta: {
          brokenLevel: h2.price,
          breakCandle: breakIdx,
          priorTrend: 'down',
          structureShift: 'bullish',
        },
      });
    }
  }
  
  // CHOCH Bear: In uptrend (higher lows), price breaks below a higher low
  for (let i = 2; i < lows.length; i++) {
    const l1 = lows[i - 2];
    const l2 = lows[i - 1];
    const l3 = lows[i];
    
    // Confirm uptrend: ascending lows
    if (l2.price <= l1.price) continue;
    
    // CHOCH: l3 breaks below l2 (breaking the higher low sequence)
    if (l3.price < l2.price) {
      const breakIdx = findBreakCandleBelow(candles, l2.price, l2.index, l3.index);
      if (breakIdx === -1) continue;
      
      // Validate with highs (should have been making higher highs)
      const relevantHighs = highs.filter(h => h.index > l1.index && h.index < l3.index);
      const isUptrend = isAscending(relevantHighs);
      if (!isUptrend) continue;
      
      const conf = calculateCHOCHConfidence(candles, breakIdx, l2.price, 'bear');
      
      results.push({
        type: 'CHOCH_BEAR',
        direction: 'BEAR',
        confidence: conf,
        startIndex: l2.index,
        endIndex: breakIdx,
        priceLevels: [l2.price],
        meta: {
          brokenLevel: l2.price,
          breakCandle: breakIdx,
          priorTrend: 'up',
          structureShift: 'bearish',
        },
      });
    }
  }
  
  return results;
}

function findBreakCandleAbove(candles: Candle[], level: number, startIdx: number, endIdx: number): number {
  for (let i = startIdx + 1; i <= endIdx && i < candles.length; i++) {
    if (candles[i].c > level) return i;
  }
  return -1;
}

function findBreakCandleBelow(candles: Candle[], level: number, startIdx: number, endIdx: number): number {
  for (let i = startIdx + 1; i <= endIdx && i < candles.length; i++) {
    if (candles[i].c < level) return i;
  }
  return -1;
}

function isDescending(pivots: Pivot[]): boolean {
  if (pivots.length < 2) return false;
  for (let i = 1; i < pivots.length; i++) {
    if (pivots[i].price >= pivots[i - 1].price) return false;
  }
  return true;
}

function isAscending(pivots: Pivot[]): boolean {
  if (pivots.length < 2) return false;
  for (let i = 1; i < pivots.length; i++) {
    if (pivots[i].price <= pivots[i - 1].price) return false;
  }
  return true;
}

function calculateCHOCHConfidence(
  candles: Candle[],
  breakIdx: number,
  level: number,
  type: 'bull' | 'bear'
): number {
  const breakCandle = candles[breakIdx];
  const breakStrength = Math.abs(breakCandle.c - level) / level;
  
  // CHOCH is a strong signal
  return Math.min(0.88, 0.65 + 0.18 * Math.min(breakStrength * 20, 1));
}
