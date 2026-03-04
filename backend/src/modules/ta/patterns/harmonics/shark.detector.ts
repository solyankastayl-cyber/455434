/**
 * Phase R5: Shark Pattern Detector
 * 
 * Ratios:
 * - XAB: 0.382-0.618 (B retraces 38.2-61.8% of XA)
 * - ABC: 1.130-1.618 (C extends 113-161.8% of AB - goes beyond A)
 * - BCD: 1.618-2.240 (D extends 161.8-224% of BC)
 * - XAD: 0.886-1.130 (D completes near or slightly past X)
 */

import { PatternInput, PatternResult, Pivot } from '../utils/pattern_types.js';
import { findAllPivots } from '../utils/swing_points.js';
import {
  FIB_RATIOS,
  validateXAB,
  xadRatio,
  patternDirection,
  retracementRatio,
  extensionRatio,
} from './harmonic_utils.js';

export function detectShark(input: PatternInput): PatternResult[] {
  const pivots = input.pivots || findAllPivots(input.candles, 5);
  const results: PatternResult[] = [];
  
  if (pivots.length < 5) return [];
  
  for (let i = 0; i < pivots.length - 4; i++) {
    const X = pivots[i];
    const A = pivots[i + 1];
    const B = pivots[i + 2];
    const C = pivots[i + 3];
    const D = pivots[i + 4];
    
    if (!isAlternating(X, A, B, C, D)) continue;
    
    // XAB: 38.2-61.8%
    if (!validateXAB(X.price, A.price, B.price, FIB_RATIOS.R382, FIB_RATIOS.R618)) continue;
    
    // ABC: C extends beyond A (113-161.8% of AB)
    const abcExt = extensionRatio(A.price, B.price, C.price);
    if (abcExt < FIB_RATIOS.R1130 - 0.05 || abcExt > FIB_RATIOS.R1618 + 0.05) continue;
    
    // BCD: 161.8-224%
    const bcdExt = extensionRatio(B.price, C.price, D.price);
    if (bcdExt < FIB_RATIOS.R1618 - 0.05 || bcdExt > FIB_RATIOS.R2240 + 0.05) continue;
    
    // XAD: 88.6-113%
    const xad = xadRatio(X.price, A.price, D.price);
    if (xad < FIB_RATIOS.R886 - 0.05 || xad > FIB_RATIOS.R1130 + 0.05) continue;
    
    const direction = patternDirection(X.price, A.price);
    const conf = calculateConfidence(X, A, B, C, D);
    
    results.push({
      type: direction === 'BULL' ? 'HARMONIC_SHARK_BULL' : 'HARMONIC_SHARK_BEAR',
      direction,
      confidence: conf,
      startIndex: X.index,
      endIndex: D.index,
      priceLevels: [X.price, A.price, B.price, C.price, D.price],
      meta: {
        pattern: 'shark',
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
  const xad = Math.abs(D.price - X.price) / Math.abs(A.price - X.price);
  
  const xabErr = Math.min(Math.abs(xab - FIB_RATIOS.R382), Math.abs(xab - FIB_RATIOS.R618));
  const xadErr = Math.min(Math.abs(xad - FIB_RATIOS.R886), Math.abs(xad - FIB_RATIOS.R1130));
  
  const totalErr = xabErr + xadErr;
  return Math.min(0.80, Math.max(0.45, 0.75 - totalErr * 1.5));
}
