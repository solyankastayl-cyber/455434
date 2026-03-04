/**
 * K-Means Clustering Service
 * Deterministic implementation with cosine distance
 */

import type { ClusterConfig, ClusterAssignment } from '../contracts/cluster.contract.js';
import { cosineDist, meanVec, centroidShift } from '../utils/distance.js';
import { farthestSeed } from '../utils/farthest_seed.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface KMeansResult {
  centroids: number[][];
  assignments: ClusterAssignment[];
  inertia: number;
  avgDistance: number;
  iters: number;
}

// ═══════════════════════════════════════════════════════════════
// MAIN K-MEANS
// ═══════════════════════════════════════════════════════════════

/**
 * Run k-means clustering
 * 
 * Features:
 * - Deterministic (farthest point seeding)
 * - Cosine distance
 * - Convergence check
 */
export function runKMeans(points: number[][], config: ClusterConfig): KMeansResult {
  const { k, maxIter } = config;
  
  if (points.length === 0) throw new Error('No points');
  if (points.length < k) throw new Error(`Not enough points (${points.length}) for k=${k}`);
  
  const dims = points[0].length;
  for (const p of points) {
    if (p.length !== dims) throw new Error('Dimension mismatch in points');
  }
  
  console.log(`[KMeans] Starting: ${points.length} points, k=${k}, dims=${dims}`);
  
  // Initialize centroids deterministically
  const seedIdxs = farthestSeed(points, k);
  let centroids = seedIdxs.map(i => points[i].slice());
  
  console.log(`[KMeans] Seed indices: ${seedIdxs.join(', ')}`);
  
  let assignments: ClusterAssignment[] = [];
  let inertia = 0;
  let avgDistance = 0;
  
  for (let iter = 0; iter < maxIter; iter++) {
    // Assign each point to nearest centroid
    const buckets: number[][][] = Array.from({ length: k }, () => []);
    assignments = [];
    inertia = 0;
    
    for (let i = 0; i < points.length; i++) {
      let bestC = 0;
      let bestD = Infinity;
      
      for (let c = 0; c < centroids.length; c++) {
        const d = cosineDist(points[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      
      assignments.push({ idx: i, clusterId: bestC, distance: bestD });
      buckets[bestC].push(points[i]);
      inertia += bestD * bestD;
    }
    
    avgDistance = assignments.reduce((s, a) => s + a.distance, 0) / assignments.length;
    
    // Recompute centroids
    const nextCentroids: number[][] = [];
    for (let c = 0; c < k; c++) {
      if (buckets[c].length === 0) {
        // Empty cluster: keep previous centroid (deterministic behavior)
        nextCentroids.push(centroids[c].slice());
      } else {
        nextCentroids.push(meanVec(buckets[c], dims));
      }
    }
    
    // Check convergence (total L1 shift)
    let totalShift = 0;
    for (let c = 0; c < k; c++) {
      totalShift += centroidShift(centroids[c], nextCentroids[c]);
    }
    
    centroids = nextCentroids;
    
    // Converged?
    if (totalShift < 1e-9) {
      console.log(`[KMeans] Converged at iteration ${iter + 1}`);
      return { centroids, assignments, inertia, avgDistance, iters: iter + 1 };
    }
  }
  
  console.log(`[KMeans] Reached maxIter (${maxIter})`);
  return { centroids, assignments, inertia, avgDistance, iters: maxIter };
}
