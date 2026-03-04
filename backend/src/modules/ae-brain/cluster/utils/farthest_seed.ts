/**
 * Deterministic Farthest Point Seeding
 * For k-means initialization without randomness
 */

import { cosineDist, norm } from './distance.js';

/**
 * Farthest point seeding for k-means
 * 
 * Algorithm:
 * 1. Start with point of maximum norm
 * 2. Each next centroid = point with max distance to nearest existing centroid
 * 
 * @param points - Array of vectors
 * @param k - Number of centroids
 * @returns Indices of selected points
 */
export function farthestSeed(points: number[][], k: number): number[] {
  if (points.length === 0) throw new Error('No points');
  if (k <= 0) throw new Error('k must be > 0');
  if (k > points.length) k = points.length;

  // 1) Start = max ||x|| (most extreme point)
  let startIdx = 0;
  let bestNorm = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const n = norm(points[i]);
    if (n > bestNorm) {
      bestNorm = n;
      startIdx = i;
    }
  }

  const chosen: number[] = [startIdx];

  // 2) Next = argmax minDist(x, chosen)
  while (chosen.length < k) {
    let bestIdx = -1;
    let bestMinDist = -Infinity;

    for (let i = 0; i < points.length; i++) {
      // Skip already chosen
      if (chosen.includes(i)) continue;

      // Find min distance to any chosen centroid
      let minD = Infinity;
      for (const c of chosen) {
        const d = cosineDist(points[i], points[c]);
        if (d < minD) minD = d;
      }

      // Keep track of point with max minDist
      if (minD > bestMinDist) {
        bestMinDist = minD;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break; // Less unique points than k
    chosen.push(bestIdx);
  }

  return chosen;
}
