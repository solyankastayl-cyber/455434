/**
 * C7 Cluster Math Utilities
 * Cosine distance and farthest point seeding
 */

/**
 * Dot product of two vectors
 */
export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Euclidean norm (L2)
 */
export function norm(a: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

/**
 * Cosine similarity [-1..1]
 */
export function cosineSim(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

/**
 * Cosine distance [0..2]
 * 0 = identical, 2 = opposite
 */
export function cosineDist(a: number[], b: number[]): number {
  return 1 - cosineSim(a, b);
}

/**
 * Mean vector
 */
export function meanVec(vectors: number[][], dims: number): number[] {
  const out = new Array(dims).fill(0);
  if (vectors.length === 0) return out;
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) out[i] += v[i];
  }
  for (let i = 0; i < dims; i++) out[i] /= vectors.length;
  return out;
}

/**
 * L1 shift between two vectors (for convergence check)
 */
export function centroidShift(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s;
}

/**
 * Percentile calculation
 */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}
