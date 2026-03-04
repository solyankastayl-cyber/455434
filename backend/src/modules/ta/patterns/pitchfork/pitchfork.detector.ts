/**
 * Phase R10.D: Pitchfork Detector
 * Andrew's Pitchfork pattern
 */

import { PatternResult, Pivot } from '../utils/pattern_types.js';

/**
 * Simple line from two points
 */
function lineFrom2(p1: { x: number; y: number }, p2: { x: number; y: number }): { a: number; b: number } {
  const dx = p2.x - p1.x;
  const a = dx === 0 ? 0 : (p2.y - p1.y) / dx;
  const b = p1.y - a * p1.x;
  return { a, b };
}

/**
 * Get Y value at X on a line
 */
function yAt(line: { a: number; b: number }, x: number): number {
  return line.a * x + line.b;
}

export function detectPitchfork(pivots: Pivot[], candlesLength: number): PatternResult[] {
  const results: PatternResult[] = [];
  
  if (pivots.length < 3) return results;
  
  // Try recent pivot combinations
  for (let i = 0; i < pivots.length - 2; i++) {
    const A = pivots[i];
    const B = pivots[i + 1];
    const C = pivots[i + 2];
    
    // Must alternate
    if (A.kind === B.kind || B.kind === C.kind) continue;
    
    // Calculate median line (from B to midpoint of A-C)
    const mid = {
      x: (A.index + C.index) / 2,
      y: (A.price + C.price) / 2,
    };
    
    const median = lineFrom2(
      { x: B.index, y: B.price },
      mid
    );
    
    // Skip flat lines
    if (Math.abs(median.a) < 1e-9) continue;
    
    const end = Math.min(candlesLength - 1, C.index + 20);
    
    // Direction: if B is HIGH, price expected to decline (BEAR handle)
    const direction = B.kind === 'HIGH' ? 'BEAR' : 'BULL';
    
    results.push({
      type: 'PITCHFORK',
      direction,
      confidence: 0.70,
      startIndex: A.index,
      endIndex: end,
      priceLevels: [yAt(median, end)],
      meta: {
        pivotA: A,
        pivotB: B,
        pivotC: C,
        medianSlope: median.a,
      },
    });
  }
  
  return results;
}

/**
 * Detect pitchfork break (price breaks median line)
 */
export function detectPitchforkBreak(
  pivots: Pivot[],
  candles: { c: number; h: number; l: number }[]
): PatternResult[] {
  const results: PatternResult[] = [];
  
  if (pivots.length < 3 || candles.length < 10) return results;
  
  // Get most recent pitchfork setup
  const recent = pivots.slice(-5);
  for (let i = 0; i < recent.length - 2; i++) {
    const A = recent[i];
    const B = recent[i + 1];
    const C = recent[i + 2];
    
    if (A.kind === B.kind || B.kind === C.kind) continue;
    
    const mid = {
      x: (A.index + C.index) / 2,
      y: (A.price + C.price) / 2,
    };
    
    const median = lineFrom2(
      { x: B.index, y: B.price },
      mid
    );
    
    // Check for break in recent candles
    for (let k = C.index + 1; k < candles.length; k++) {
      const expectedY = yAt(median, k);
      const candle = candles[k];
      
      // Bullish break above
      if (B.kind === 'LOW' && candle.c > expectedY && candle.l < expectedY) {
        results.push({
          type: 'PITCHFORK_BREAK',
          direction: 'BULL',
          confidence: 0.72,
          startIndex: A.index,
          endIndex: k,
          priceLevels: [expectedY],
          meta: { breakBar: k, breakType: 'above' },
        });
        break;
      }
      
      // Bearish break below
      if (B.kind === 'HIGH' && candle.c < expectedY && candle.h > expectedY) {
        results.push({
          type: 'PITCHFORK_BREAK',
          direction: 'BEAR',
          confidence: 0.72,
          startIndex: A.index,
          endIndex: k,
          priceLevels: [expectedY],
          meta: { breakBar: k, breakType: 'below' },
        });
        break;
      }
    }
  }
  
  return results;
}

export function runPitchforkDetectors(
  pivots: Pivot[],
  candles: { c: number; h: number; l: number }[]
): PatternResult[] {
  return [
    ...detectPitchfork(pivots, candles.length),
    ...detectPitchforkBreak(pivots, candles),
  ];
}
