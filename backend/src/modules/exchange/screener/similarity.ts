/**
 * BLOCK 1.4.5 — Similarity Engine
 * =================================
 * Cosine similarity for pattern matching (no ML).
 */

/**
 * Cosine similarity between two vectors
 * Returns value in [-1, 1] where 1 = identical direction
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-9) return 0;

  return dot / denom;
}

/**
 * Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.pow(a[i] - b[i], 2);
  }
  return Math.sqrt(sum);
}

/**
 * Find top-N most similar vectors from a reference set
 */
export function findMostSimilar(
  target: number[],
  references: Array<{ id: string; vector: number[] }>,
  topN = 5
): Array<{ id: string; similarity: number }> {
  const similarities = references.map(ref => ({
    id: ref.id,
    similarity: cosineSimilarity(target, ref.vector),
  }));

  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);
}

console.log('[Screener] Similarity Engine loaded');
