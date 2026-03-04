/**
 * Phase R7: Break of Structure (BOS) Detector
 * Market structure pattern: continuation of trend
 * 
 * BOS Bull: Price breaks above previous swing high in uptrend (HH)
 * BOS Bear: Price breaks below previous swing low in downtrend (LL)
 */

import { PatternInput, PatternResult, Pivot, Candle } from '../utils/pattern_types.js';
import { findSwingHighs, findSwingLows } from '../utils/swing_points.js';

export function detectBOS(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  const highs = findSwingHighs(candles, 3);
  const lows = findSwingLows(candles, 3);
  
  if (highs.length < 2 || lows.length < 2) return [];
  
  // BOS Bull: higher high breaks previous high
  for (let i = 1; i < highs.length; i++) {
    const prevHigh = highs[i - 1];
    const currHigh = highs[i];
    
    // Find the break candle
    const breakIdx = findBreakCandle(candles, prevHigh.price, currHigh.index, 'above');
    if (breakIdx === -1) continue;
    
    // Validate uptrend context (higher lows)
    const lowsBetween = lows.filter(l => l.index > prevHigh.index && l.index < currHigh.index);
    if (lowsBetween.length > 0) {
      const prevLow = findPrevLow(lows, prevHigh.index);
      if (prevLow && lowsBetween.some(l => l.price < prevLow.price)) continue; // Lower low = not valid BOS
    }
    
    const conf = calculateBOSConfidence(candles, breakIdx, prevHigh.price);
    
    results.push({
      type: 'BOS_BULL',
      direction: 'BULL',
      confidence: conf,
      startIndex: prevHigh.index,
      endIndex: breakIdx,
      priceLevels: [prevHigh.price],
      meta: {
        brokenLevel: prevHigh.price,
        breakCandle: breakIdx,
        structure: 'higher_high',
      },
    });
  }
  
  // BOS Bear: lower low breaks previous low
  for (let i = 1; i < lows.length; i++) {
    const prevLow = lows[i - 1];
    const currLow = lows[i];
    
    const breakIdx = findBreakCandle(candles, prevLow.price, currLow.index, 'below');
    if (breakIdx === -1) continue;
    
    // Validate downtrend context (lower highs)
    const highsBetween = highs.filter(h => h.index > prevLow.index && h.index < currLow.index);
    if (highsBetween.length > 0) {
      const prevHigh = findPrevHigh(highs, prevLow.index);
      if (prevHigh && highsBetween.some(h => h.price > prevHigh.price)) continue;
    }
    
    const conf = calculateBOSConfidence(candles, breakIdx, prevLow.price);
    
    results.push({
      type: 'BOS_BEAR',
      direction: 'BEAR',
      confidence: conf,
      startIndex: prevLow.index,
      endIndex: breakIdx,
      priceLevels: [prevLow.price],
      meta: {
        brokenLevel: prevLow.price,
        breakCandle: breakIdx,
        structure: 'lower_low',
      },
    });
  }
  
  return results;
}

function findBreakCandle(
  candles: Candle[],
  level: number,
  endIdx: number,
  direction: 'above' | 'below'
): number {
  for (let i = 0; i < endIdx && i < candles.length; i++) {
    if (direction === 'above' && candles[i].c > level) return i;
    if (direction === 'below' && candles[i].c < level) return i;
  }
  return -1;
}

function findPrevLow(lows: Pivot[], beforeIdx: number): Pivot | null {
  for (let i = lows.length - 1; i >= 0; i--) {
    if (lows[i].index < beforeIdx) return lows[i];
  }
  return null;
}

function findPrevHigh(highs: Pivot[], beforeIdx: number): Pivot | null {
  for (let i = highs.length - 1; i >= 0; i--) {
    if (highs[i].index < beforeIdx) return highs[i];
  }
  return null;
}

function calculateBOSConfidence(candles: Candle[], breakIdx: number, level: number): number {
  const breakCandle = candles[breakIdx];
  const breakStrength = Math.abs(breakCandle.c - level) / level;
  
  return Math.min(0.90, 0.60 + 0.20 * Math.min(breakStrength * 20, 1));
}
