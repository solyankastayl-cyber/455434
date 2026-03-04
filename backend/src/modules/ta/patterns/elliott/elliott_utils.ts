/**
 * Phase R8: Elliott Wave Utilities
 */

import { Pivot } from '../utils/pattern_types.js';

/**
 * Calculate price move between two points
 */
export function move(a: number, b: number): number {
  return b - a;
}

/**
 * Calculate retracement ratio
 */
export function retrace(a: number, b: number, c: number): number {
  const ab = b - a;
  if (Math.abs(ab) < 1e-9) return 0;
  return Math.abs((c - b) / ab);
}

/**
 * Calculate extension ratio
 */
export function extension(a: number, b: number, c: number): number {
  const ab = b - a;
  if (Math.abs(ab) < 1e-9) return 0;
  return Math.abs((c - b) / ab);
}

/**
 * Check if pivots alternate HIGH/LOW
 */
export function alternating(pivots: Pivot[]): boolean {
  for (let i = 1; i < pivots.length; i++) {
    if (pivots[i].kind === pivots[i - 1].kind) return false;
  }
  return true;
}

/**
 * Get wave sizes from 6 pivots (5-wave structure)
 */
export function getWaveSizes(pivots: Pivot[]): {
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  w5: number;
} | null {
  if (pivots.length < 6) return null;
  
  return {
    w1: pivots[1].price - pivots[0].price,
    w2: pivots[2].price - pivots[1].price,
    w3: pivots[3].price - pivots[2].price,
    w4: pivots[4].price - pivots[3].price,
    w5: pivots[5].price - pivots[4].price,
  };
}

/**
 * Validate Elliott Wave rules
 * - Wave 2 cannot retrace more than 100% of Wave 1
 * - Wave 3 cannot be the shortest impulse wave
 * - Wave 4 cannot overlap Wave 1
 */
export function validateElliottRules(waves: {
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  w5: number;
}, pivots: Pivot[]): {
  valid: boolean;
  wave2Rule: boolean;
  wave3Rule: boolean;
  wave4Rule: boolean;
} {
  const { w1, w2, w3, w4, w5 } = waves;
  
  // Wave 2 retracement < 100% of Wave 1
  const wave2Rule = Math.abs(w2) < Math.abs(w1);
  
  // Wave 3 is NOT the shortest (among w1, w3, w5)
  const impulseWaves = [Math.abs(w1), Math.abs(w3), Math.abs(w5)];
  const minImpulse = Math.min(...impulseWaves);
  const wave3Rule = Math.abs(w3) > minImpulse * 0.99; // Wave 3 not shortest
  
  // Wave 4 no overlap with Wave 1
  // For bullish: wave4 low > wave1 high
  // For bearish: wave4 high < wave1 low
  const bullish = w1 > 0;
  const wave1End = pivots[1].price;
  const wave4End = pivots[4].price;
  
  const wave4Rule = bullish
    ? wave4End > pivots[0].price // Wave 4 stays above Wave 0
    : wave4End < pivots[0].price; // Wave 4 stays below Wave 0
  
  return {
    valid: wave2Rule && wave3Rule && wave4Rule,
    wave2Rule,
    wave3Rule,
    wave4Rule,
  };
}

/**
 * Fibonacci ratios commonly seen in Elliott Waves
 */
export const ELLIOTT_FIBS = {
  R236: 0.236,
  R382: 0.382,
  R500: 0.500,
  R618: 0.618,
  R786: 0.786,
  R1000: 1.000,
  R1618: 1.618,
  R2618: 2.618,
};
