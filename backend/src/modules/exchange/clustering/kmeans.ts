/**
 * BLOCK 2.12 — KMeans Clustering
 * ==============================
 * Simple KMeans with cosine distance (no heavy libs).
 */

import { cosineDistance } from './vector_builder.js';

export type KMeansResult = {
  centroids: number[][];
  assignments: number[];
  distances: number[];
};

function meanVector(vectors: number[][]): number[] {
  if (!vectors.length) return [];
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

function pickKMeansPlusPlus(vectors: number[][], k: number): number[][] {
  const centroids: number[][] = [];
  centroids.push([...vectors[Math.floor(Math.random() * vectors.length)]]);

  while (centroids.length < k) {
    const d2 = vectors.map((v) => {
      let best = Infinity;
      for (const c of centroids) {
        best = Math.min(best, cosineDistance(v, c));
      }
      return best * best;
    });
    const sum = d2.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * sum;
    let idx = 0;
    for (; idx < d2.length; idx++) {
      r -= d2[idx];
      if (r <= 0) break;
    }
    centroids.push([...vectors[Math.min(idx, vectors.length - 1)]]);
  }
  return centroids;
}

export function kmeansCosine(vectors: number[][], k: number, iters = 15): KMeansResult {
  const n = vectors.length;
  if (n === 0 || k <= 0) {
    return { centroids: [], assignments: [], distances: [] };
  }

  const actualK = Math.min(k, n);
  const centroids = pickKMeansPlusPlus(vectors, actualK);

  let assignments = new Array(n).fill(0);
  let distances = new Array(n).fill(1);

  for (let t = 0; t < iters; t++) {
    // Assign each vector to nearest centroid
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      let bestId = 0;
      for (let c = 0; c < actualK; c++) {
        const d = cosineDistance(vectors[i], centroids[c]);
        if (d < best) {
          best = d;
          bestId = c;
        }
      }
      assignments[i] = bestId;
      distances[i] = best;
    }

    // Recompute centroids
    const buckets: number[][][] = Array.from({ length: actualK }, () => []);
    for (let i = 0; i < n; i++) {
      buckets[assignments[i]].push(vectors[i]);
    }

    for (let c = 0; c < actualK; c++) {
      if (buckets[c].length > 0) {
        centroids[c] = meanVector(buckets[c]);
      }
    }
  }

  return { centroids, assignments, distances };
}

console.log('[Clustering] KMeans loaded');
