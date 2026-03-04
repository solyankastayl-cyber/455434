/**
 * Phase R9: Clustering Utilities
 * Group similar patterns together
 */

import { overlap, near, isDuplicate } from './dedup.js';

/**
 * Cluster patterns by overlap and price proximity
 * Returns array of clusters, each containing similar patterns
 */
export function clusterPatterns(
  patterns: any[],
  overlapThreshold = 0.6,
  priceTol = 0.003
): any[][] {
  const clusters: any[][] = [];
  const used = new Set<number>();
  
  for (let i = 0; i < patterns.length; i++) {
    if (used.has(i)) continue;
    
    const base = patterns[i];
    const bucket = [base];
    used.add(i);
    
    for (let j = i + 1; j < patterns.length; j++) {
      if (used.has(j)) continue;
      
      const p = patterns[j];
      
      if (isDuplicate(base, p, overlapThreshold, priceTol)) {
        bucket.push(p);
        used.add(j);
      }
    }
    
    clusters.push(bucket);
  }
  
  return clusters;
}

/**
 * Select representative from cluster (highest confidence)
 */
export function selectRepresentative(cluster: any[]): any {
  if (cluster.length === 0) return null;
  if (cluster.length === 1) return cluster[0];
  
  return cluster.reduce((best, p) => 
    (p.confidence || 0) > (best.confidence || 0) ? p : best
  );
}

/**
 * Deduplicate patterns by clustering and selecting representatives
 */
export function deduplicatePatterns(
  patterns: any[],
  overlapThreshold = 0.6,
  priceTol = 0.003
): any[] {
  const clusters = clusterPatterns(patterns, overlapThreshold, priceTol);
  
  return clusters
    .map(selectRepresentative)
    .filter(p => p != null);
}

/**
 * Merge cluster confidences (weighted average)
 */
export function mergeClusterConfidence(cluster: any[]): number {
  if (cluster.length === 0) return 0;
  
  const totalConf = cluster.reduce((s, p) => s + (p.confidence || 0), 0);
  const avgConf = totalConf / cluster.length;
  
  // Bonus for multiple confirmations (capped)
  const confirmationBonus = Math.min(0.1, cluster.length * 0.02);
  
  return Math.min(0.95, avgConf + confirmationBonus);
}
