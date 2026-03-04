/**
 * Phase R5: Harmonic Pattern Utilities
 * Fibonacci ratios and validation helpers
 */

export const FIB_RATIOS = {
  R236: 0.236,
  R382: 0.382,
  R500: 0.500,
  R618: 0.618,
  R786: 0.786,
  R886: 0.886,
  R1000: 1.000,
  R1130: 1.130,
  R1272: 1.272,
  R1414: 1.414,
  R1618: 1.618,
  R2000: 2.000,
  R2240: 2.240,
  R2618: 2.618,
  R3140: 3.140,
  R3618: 3.618,
};

export interface HarmonicPoint {
  index: number;
  price: number;
}

export interface XABCDPattern {
  X: HarmonicPoint;
  A: HarmonicPoint;
  B: HarmonicPoint;
  C: HarmonicPoint;
  D: HarmonicPoint;
}

export interface ABCDPattern {
  A: HarmonicPoint;
  B: HarmonicPoint;
  C: HarmonicPoint;
  D: HarmonicPoint;
}

/**
 * Calculate retracement ratio: how much BC retraces AB
 */
export function retracementRatio(a: number, b: number, c: number): number {
  const ab = Math.abs(b - a);
  const bc = Math.abs(c - b);
  return ab === 0 ? 0 : bc / ab;
}

/**
 * Calculate extension ratio: how much CD extends relative to BC
 */
export function extensionRatio(b: number, c: number, d: number): number {
  const bc = Math.abs(c - b);
  const cd = Math.abs(d - c);
  return bc === 0 ? 0 : cd / bc;
}

/**
 * Check if a value is within tolerance of a target ratio
 */
export function withinFibRange(
  value: number,
  target: number,
  tolerance = 0.05
): boolean {
  return Math.abs(value - target) <= tolerance;
}

/**
 * Check if a value is within a range of ratios
 */
export function withinFibRangeMulti(
  value: number,
  targets: number[],
  tolerance = 0.05
): boolean {
  return targets.some(t => withinFibRange(value, t, tolerance));
}

/**
 * Validate XAB leg (B retracement of XA)
 */
export function validateXAB(
  x: number, a: number, b: number,
  minRatio: number, maxRatio: number,
  tolerance = 0.05
): boolean {
  const ratio = retracementRatio(x, a, b);
  return ratio >= minRatio - tolerance && ratio <= maxRatio + tolerance;
}

/**
 * Validate ABC leg (C retracement of AB)
 */
export function validateABC(
  a: number, b: number, c: number,
  minRatio: number, maxRatio: number,
  tolerance = 0.05
): boolean {
  const ratio = retracementRatio(a, b, c);
  return ratio >= minRatio - tolerance && ratio <= maxRatio + tolerance;
}

/**
 * Validate BCD leg (D extension of BC)
 */
export function validateBCD(
  b: number, c: number, d: number,
  minRatio: number, maxRatio: number,
  tolerance = 0.05
): boolean {
  const ratio = extensionRatio(b, c, d);
  return ratio >= minRatio - tolerance && ratio <= maxRatio + tolerance;
}

/**
 * Calculate XAD ratio (D relative to XA)
 */
export function xadRatio(x: number, a: number, d: number): number {
  const xa = Math.abs(a - x);
  const xd = Math.abs(d - x);
  return xa === 0 ? 0 : xd / xa;
}

/**
 * Determine pattern direction
 */
export function patternDirection(x: number, a: number): 'BULL' | 'BEAR' {
  return a > x ? 'BEAR' : 'BULL';
}
