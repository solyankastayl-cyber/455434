/**
 * Phase R5: Butterfly Pattern Detector
 * 
 * Ratios:
 * - XAB: 0.786 (B retraces 78.6% of XA)
 * - ABC: 0.382-0.886 (C retraces 38.2-88.6% of AB)
 * - BCD: 1.618-2.618 (D extends 161.8-261.8% of BC)
 * - XAD: 1.272-1.618 (D extends beyond X, 127.2-161.8% of XA)
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

export function detectButterfly(input: PatternInput): PatternResult[] {
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
    
    // XAB: ~78.6%
    if (!validateXAB(X.price, A.price, B.price, 0.72, 0.84)) continue;
    
    // ABC: 38.2-88.6%
    if (!validateABC(A.price, B.price, C.price, FIB_RATIOS.R382, FIB_RATIOS.R886)) continue;
    
    // BCD: 161.8-261.8%
    if (!validateBCD(B.price, C.price, D.price, FIB_RATIOS.R1618, FIB_RATIOS.R2618)) continue;
    
    // XAD: 127.2-161.8% (D extends beyond X)
    const xad = xadRatio(X.price, A.price, D.price);
    if (xad < FIB_RATIOS.R1272 - 0.05 || xad > FIB_RATIOS.R1618 + 0.05) continue;
    
    const direction = patternDirection(X.price, A.price);
    const conf = calculateConfidence(X, A, B, C, D);
    
    results.push({
      type: direction === 'BULL' ? 'HARMONIC_BUTTERFLY_BULL' : 'HARMONIC_BUTTERFLY_BEAR',
      direction,
      confidence: conf,
      startIndex: X.index,
      endIndex: D.index,
      priceLevels: [X.price, A.price, B.price, C.price, D.price],
      meta: {
        pattern: 'butterfly',
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
  
  const xabErr = Math.abs(xab - FIB_RATIOS.R786);
  const xadErr = Math.min(Math.abs(xad - FIB_RATIOS.R1272), Math.abs(xad - FIB_RATIOS.R1618));
  
  const totalErr = xabErr + xadErr;
  return Math.min(0.85, Math.max(0.48, 0.80 - totalErr * 2));
}
