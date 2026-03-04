/**
 * AE Brain Math Utilities
 * Pure functions for cosine similarity, KNN, softmax
 */

/**
 * Dot product of two vectors
 */
export function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Euclidean norm (L2)
 */
export function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Cosine similarity [-1..1]
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

/**
 * Cosine distance [0..2]
 * 0 = identical, 2 = opposite
 */
export function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}

/**
 * Softmax with numerical stability
 */
export function softmax(scores: number[]): number[] {
  const max = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

/**
 * Clamp value to range
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Safe number check (no NaN, no Infinity)
 */
export function safeNumber(value: number, fallback: number = 0): number {
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    return fallback;
  }
  return value;
}
