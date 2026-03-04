/**
 * Phase R5: Gartley Pattern Detector
 * Classic XABCD harmonic pattern
 * 
 * Ratios:
 * - XAB: 0.618 (B retraces 61.8% of XA)
 * - ABC: 0.382-0.886 (C retraces 38.2-88.6% of AB)
 * - BCD: 1.272-1.618 (D extends 127.2-161.8% of BC)
 * - XAD: 0.786 (D completes at 78.6% of XA)
 */

import { PatternInput, PatternResult, Pivot } from '../utils/pattern_types.js';
import { findAllPivots } from '../utils/swing_points.js';
import {
  FIB_RATIOS,
  validateXAB,
  validateABC,
  validateBCD,
  xadRatio,
  withinFibRange,
  patternDirection,
} from './harmonic_utils.js';

export function detectGartley(input: PatternInput): PatternResult[] {
  const pivots = input.pivots || findAllPivots(input.candles, 5);
  const results: PatternResult[] = [];
  
  if (pivots.length < 5) return [];
  
  // Try all possible XABCD combinations
  for (let i = 0; i < pivots.length - 4; i++) {
    const X = pivots[i];
    const A = pivots[i + 1];
    const B = pivots[i + 2];
    const C = pivots[i + 3];
    const D = pivots[i + 4];
    
    // Validate sequence: alternating highs and lows
    if (!isAlternating(X, A, B, C, D)) continue;
    
    // Validate XAB: B retraces ~61.8% of XA
    if (!validateXAB(X.price, A.price, B.price, 0.55, 0.68)) continue;
    
    // Validate ABC: C retraces 38.2-88.6% of AB
    if (!validateABC(A.price, B.price, C.price, FIB_RATIOS.R382, FIB_RATIOS.R886)) continue;
    
    // Validate BCD: D extends 127.2-161.8% of BC
    if (!validateBCD(B.price, C.price, D.price, FIB_RATIOS.R1272, FIB_RATIOS.R1618)) continue;
    
    // Validate XAD: D completes at ~78.6% of XA
    const xad = xadRatio(X.price, A.price, D.price);
    if (!withinFibRange(xad, FIB_RATIOS.R786, 0.05)) continue;
    
    const direction = patternDirection(X.price, A.price);
    
    // Calculate confidence based on how close ratios are to ideal
    const conf = calculateConfidence(X, A, B, C, D);
    
    results.push({
      type: direction === 'BULL' ? 'HARMONIC_GARTLEY_BULL' : 'HARMONIC_GARTLEY_BEAR',
      direction,
      confidence: conf,
      startIndex: X.index,
      endIndex: D.index,
      priceLevels: [X.price, A.price, B.price, C.price, D.price],
      meta: {
        pattern: 'gartley',
        points: { X, A, B, C, D },
        xadRatio: xad,
      },
    });
  }
  
  return results;
}

function isAlternating(...pivots: Pivot[]): boolean {
  for (let i = 1; i < pivots.length; i++) {
    if (pivots[i].kind === pivots[i - 1].kind) return false;
  }
  return true;
}

function calculateConfidence(X: Pivot, A: Pivot, B: Pivot, C: Pivot, D: Pivot): number {
  const xab = Math.abs(B.price - X.price) / Math.abs(A.price - X.price);
  const abc = Math.abs(C.price - A.price) / Math.abs(B.price - A.price);
  const xad = Math.abs(D.price - X.price) / Math.abs(A.price - X.price);
  
  // Ideal ratios
  const xabErr = Math.abs(xab - FIB_RATIOS.R618);
  const xadErr = Math.abs(xad - FIB_RATIOS.R786);
  
  const totalErr = xabErr + xadErr;
  return Math.min(0.90, Math.max(0.50, 0.85 - totalErr * 2));
}
