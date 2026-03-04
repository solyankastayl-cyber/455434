/**
 * Phase AF5: Pattern Clustering
 * 
 * Groups similar market structures into clusters.
 * Uses K-Means for simplicity (can be extended to HDBSCAN).
 */

import { v4 as uuid } from 'uuid';
import { ShapeEmbedding, DiscoveredCluster } from './discovery_types.js';
import { calculateDistance } from './shape_embedding.js';

// ═══════════════════════════════════════════════════════════════
// K-MEANS CLUSTERING
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize centroids using K-Means++ method
 */
function initializeCentroids(embeddings: ShapeEmbedding[], k: number): number[][] {
  if (embeddings.length === 0 || k <= 0) return [];
  
  const centroids: number[][] = [];
  const vectorDim = embeddings[0].vector.length;
  
  // First centroid: random
  const firstIdx = Math.floor(Math.random() * embeddings.length);
  centroids.push([...embeddings[firstIdx].vector]);
  
  // Remaining centroids: weighted by distance
  while (centroids.length < k) {
    const distances = embeddings.map(e => {
      let minDist = Infinity;
      for (const c of centroids) {
        const dist = vectorDistance(e.vector, c);
        if (dist < minDist) minDist = dist;
      }
      return minDist * minDist; // Square for weighting
    });
    
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalDist;
    
    for (let i = 0; i < distances.length; i++) {
      random -= distances[i];
      if (random <= 0) {
        centroids.push([...embeddings[i].vector]);
        break;
      }
    }
    
    // Fallback
    if (centroids.length < k && random > 0) {
      centroids.push([...embeddings[embeddings.length - 1].vector]);
    }
  }
  
  return centroids;
}

/**
 * Calculate vector distance
 */
function vectorDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.pow(a[i] - b[i], 2);
  }
  return Math.sqrt(sum);
}

/**
 * Assign embeddings to nearest centroid
 */
function assignToClusters(
  embeddings: ShapeEmbedding[],
  centroids: number[][]
): number[] {
  return embeddings.map(e => {
    let minDist = Infinity;
    let minIdx = 0;
    
    for (let i = 0; i < centroids.length; i++) {
      const dist = vectorDistance(e.vector, centroids[i]);
      if (dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    }
    
    return minIdx;
  });
}

/**
 * Update centroids based on assignments
 */
function updateCentroids(
  embeddings: ShapeEmbedding[],
  assignments: number[],
  k: number
): number[][] {
  const dim = embeddings[0]?.vector.length || 0;
  const newCentroids: number[][] = [];
  
  for (let i = 0; i < k; i++) {
    const members = embeddings.filter((_, idx) => assignments[idx] === i);
    
    if (members.length === 0) {
      // Empty cluster: reinitialize randomly
      const randomIdx = Math.floor(Math.random() * embeddings.length);
      newCentroids.push([...embeddings[randomIdx].vector]);
    } else {
      // Average of members
      const centroid = new Array(dim).fill(0);
      for (const m of members) {
        for (let d = 0; d < dim; d++) {
          centroid[d] += m.vector[d];
        }
      }
      for (let d = 0; d < dim; d++) {
        centroid[d] /= members.length;
      }
      newCentroids.push(centroid);
    }
  }
  
  return newCentroids;
}

/**
 * Check convergence
 */
function hasConverged(oldCentroids: number[][], newCentroids: number[][], threshold: number = 0.001): boolean {
  for (let i = 0; i < oldCentroids.length; i++) {
    if (vectorDistance(oldCentroids[i], newCentroids[i]) > threshold) {
      return false;
    }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// MAIN CLUSTERING FUNCTION
// ═══════════════════════════════════════════════════════════════

export interface ClusteringConfig {
  k: number;                    // Number of clusters (for K-Means)
  maxIterations: number;
  minClusterSize: number;       // Minimum members to keep cluster
}

export const DEFAULT_CLUSTERING_CONFIG: ClusteringConfig = {
  k: 10,
  maxIterations: 100,
  minClusterSize: 5,
};

/**
 * Run K-Means clustering on embeddings
 */
export function runKMeansClustering(
  embeddings: ShapeEmbedding[],
  config: ClusteringConfig = DEFAULT_CLUSTERING_CONFIG
): DiscoveredCluster[] {
  if (embeddings.length < config.k) {
    console.warn(`[Clustering] Not enough embeddings (${embeddings.length}) for ${config.k} clusters`);
    return [];
  }
  
  // Initialize centroids
  let centroids = initializeCentroids(embeddings, config.k);
  let assignments: number[] = [];
  
  // Iterate
  for (let iter = 0; iter < config.maxIterations; iter++) {
    // Assign to clusters
    assignments = assignToClusters(embeddings, centroids);
    
    // Update centroids
    const newCentroids = updateCentroids(embeddings, assignments, config.k);
    
    // Check convergence
    if (hasConverged(centroids, newCentroids)) {
      console.log(`[Clustering] Converged at iteration ${iter}`);
      break;
    }
    
    centroids = newCentroids;
  }
  
  // Build cluster objects
  const clusters: DiscoveredCluster[] = [];
  
  for (let i = 0; i < config.k; i++) {
    const memberIndices = assignments
      .map((a, idx) => a === i ? idx : -1)
      .filter(idx => idx >= 0);
    
    if (memberIndices.length < config.minClusterSize) {
      continue; // Skip small clusters
    }
    
    const members = memberIndices.map(idx => embeddings[idx].structureId);
    
    // Calculate variance
    const variance = memberIndices.reduce((sum, idx) => {
      return sum + vectorDistance(embeddings[idx].vector, centroids[i]);
    }, 0) / memberIndices.length;
    
    clusters.push({
      clusterId: uuid(),
      members,
      memberCount: members.length,
      centroid: centroids[i],
      variance,
      label: `DISCOVERY_C${i + 1}`,
    });
  }
  
  // Sort by size
  clusters.sort((a, b) => b.memberCount - a.memberCount);
  
  return clusters;
}

// ═══════════════════════════════════════════════════════════════
// CLUSTER ANALYSIS
// ═══════════════════════════════════════════════════════════════

/**
 * Find optimal K using elbow method (simplified)
 */
export function estimateOptimalK(
  embeddings: ShapeEmbedding[],
  maxK: number = 20
): number {
  if (embeddings.length < 10) return Math.max(2, Math.floor(embeddings.length / 3));
  
  const inertias: number[] = [];
  
  for (let k = 2; k <= Math.min(maxK, embeddings.length / 3); k++) {
    const centroids = initializeCentroids(embeddings, k);
    const assignments = assignToClusters(embeddings, centroids);
    
    // Calculate inertia (sum of squared distances)
    let inertia = 0;
    for (let i = 0; i < embeddings.length; i++) {
      const dist = vectorDistance(embeddings[i].vector, centroids[assignments[i]]);
      inertia += dist * dist;
    }
    
    inertias.push(inertia);
  }
  
  // Find elbow (largest decrease ratio)
  let bestK = 2;
  let maxDecrease = 0;
  
  for (let i = 1; i < inertias.length - 1; i++) {
    const decrease = (inertias[i - 1] - inertias[i]) / inertias[i - 1];
    const nextDecrease = (inertias[i] - inertias[i + 1]) / inertias[i];
    
    const elbowScore = decrease - nextDecrease;
    if (elbowScore > maxDecrease) {
      maxDecrease = elbowScore;
      bestK = i + 2;
    }
  }
  
  return bestK;
}
