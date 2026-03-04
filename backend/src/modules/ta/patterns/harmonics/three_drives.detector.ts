/**
 * Phase R5: Three Drives Pattern Detector
 * 
 * Pattern structure: Three symmetrical drives in the same direction
 * Each drive should have similar Fibonacci relationships
 * 
 * Ratios:
 * - Drive 1 to Drive 2: 1.272-1.618 extension
 * - Drive 2 to Drive 3: 1.272-1.618 extension
 * - Corrections: 0.618-0.786 retracement
 */

import { PatternInput, PatternResult, Pivot } from '../utils/pattern_types.js';
import { findAllPivots } from '../utils/swing_points.js';
import {
  FIB_RATIOS,
  retracementRatio,
  extensionRatio,
  withinFibRange,
  withinFibRangeMulti,
} from './harmonic_utils.js';

export function detectThreeDrives(input: PatternInput): PatternResult[] {
  const pivots = input.pivots || findAllPivots(input.candles, 5);
  const results: PatternResult[] = [];
  
  // Need at least 7 points: 3 drives + 4 pivot points
  if (pivots.length < 7) return [];
  
  // Look for bullish three drives (three descending lows with retracements)
  const lows = pivots.filter(p => p.kind === 'LOW');
  const highs = pivots.filter(p => p.kind === 'HIGH');
  
  // Bullish: three lower lows with higher high corrections
  for (let i = 0; i < lows.length - 2; i++) {
    const drive1 = lows[i];
    const drive2 = lows[i + 1];
    const drive3 = lows[i + 2];
    
    // Drives should be descending for bullish reversal
    if (drive2.price >= drive1.price || drive3.price >= drive2.price) continue;
    
    // Find corrections between drives
    const corr1 = findHighBetween(highs, drive1.index, drive2.index);
    const corr2 = findHighBetween(highs, drive2.index, drive3.index);
    
    if (!corr1 || !corr2) continue;
    
    // Validate drive symmetry
    const ext1 = Math.abs(drive2.price - corr1.price) / Math.abs(drive1.price - corr1.price);
    const ext2 = Math.abs(drive3.price - corr2.price) / Math.abs(drive2.price - corr2.price);
    
    if (!withinFibRangeMulti(ext1, [FIB_RATIOS.R1272, FIB_RATIOS.R1618], 0.08)) continue;
    if (!withinFibRangeMulti(ext2, [FIB_RATIOS.R1272, FIB_RATIOS.R1618], 0.08)) continue;
    
    // Validate corrections
    const ret1 = retracementRatio(drive1.price, corr1.price, drive2.price);
    const ret2 = retracementRatio(drive2.price, corr2.price, drive3.price);
    
    if (!withinFibRangeMulti(ret1, [FIB_RATIOS.R618, FIB_RATIOS.R786], 0.08)) continue;
    if (!withinFibRangeMulti(ret2, [FIB_RATIOS.R618, FIB_RATIOS.R786], 0.08)) continue;
    
    // Symmetry check
    const symmetry = 1 - Math.abs(ext1 - ext2) / Math.max(ext1, ext2);
    
    const conf = Math.min(0.85, 0.55 + 0.15 * symmetry);
    
    results.push({
      type: 'HARMONIC_THREE_DRIVES_BULL',
      direction: 'BULL',
      confidence: conf,
      startIndex: drive1.index,
      endIndex: drive3.index,
      priceLevels: [drive1.price, corr1.price, drive2.price, corr2.price, drive3.price],
      meta: {
        pattern: 'three_drives',
        drives: [drive1, drive2, drive3],
        corrections: [corr1, corr2],
        symmetry,
      },
    });
  }
  
  // Bearish: three higher highs with lower low corrections
  for (let i = 0; i < highs.length - 2; i++) {
    const drive1 = highs[i];
    const drive2 = highs[i + 1];
    const drive3 = highs[i + 2];
    
    // Drives should be ascending for bearish reversal
    if (drive2.price <= drive1.price || drive3.price <= drive2.price) continue;
    
    const corr1 = findLowBetween(lows, drive1.index, drive2.index);
    const corr2 = findLowBetween(lows, drive2.index, drive3.index);
    
    if (!corr1 || !corr2) continue;
    
    const ext1 = Math.abs(drive2.price - corr1.price) / Math.abs(drive1.price - corr1.price);
    const ext2 = Math.abs(drive3.price - corr2.price) / Math.abs(drive2.price - corr2.price);
    
    if (!withinFibRangeMulti(ext1, [FIB_RATIOS.R1272, FIB_RATIOS.R1618], 0.08)) continue;
    if (!withinFibRangeMulti(ext2, [FIB_RATIOS.R1272, FIB_RATIOS.R1618], 0.08)) continue;
    
    const ret1 = retracementRatio(drive1.price, corr1.price, drive2.price);
    const ret2 = retracementRatio(drive2.price, corr2.price, drive3.price);
    
    if (!withinFibRangeMulti(ret1, [FIB_RATIOS.R618, FIB_RATIOS.R786], 0.08)) continue;
    if (!withinFibRangeMulti(ret2, [FIB_RATIOS.R618, FIB_RATIOS.R786], 0.08)) continue;
    
    const symmetry = 1 - Math.abs(ext1 - ext2) / Math.max(ext1, ext2);
    const conf = Math.min(0.85, 0.55 + 0.15 * symmetry);
    
    results.push({
      type: 'HARMONIC_THREE_DRIVES_BEAR',
      direction: 'BEAR',
      confidence: conf,
      startIndex: drive1.index,
      endIndex: drive3.index,
      priceLevels: [drive1.price, corr1.price, drive2.price, corr2.price, drive3.price],
      meta: {
        pattern: 'three_drives',
        drives: [drive1, drive2, drive3],
        corrections: [corr1, corr2],
        symmetry,
      },
    });
  }
  
  return results;
}

function findHighBetween(highs: Pivot[], startIdx: number, endIdx: number): Pivot | null {
  const between = highs.filter(h => h.index > startIdx && h.index < endIdx);
  if (between.length === 0) return null;
  return between.reduce((max, h) => h.price > max.price ? h : max, between[0]);
}

function findLowBetween(lows: Pivot[], startIdx: number, endIdx: number): Pivot | null {
  const between = lows.filter(l => l.index > startIdx && l.index < endIdx);
  if (between.length === 0) return null;
  return between.reduce((min, l) => l.price < min.price ? l : min, between[0]);
}
