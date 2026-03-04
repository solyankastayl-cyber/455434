/**
 * P2.B — Cluster Builder
 * 
 * Groups actors into clusters based on resolved cluster IDs.
 */

import type { ActorForCluster, ActorCluster } from './cluster_confirmation.types.js';
import { resolveClusterId } from './cluster_resolver.js';

/**
 * Build actor clusters from list of actors
 * 
 * Groups actors by their resolved clusterId and aggregates metrics.
 */
export function buildActorClusters(actors: ActorForCluster[]): ActorCluster[] {
  const clusterMap = new Map<string, ActorCluster>();
  
  for (const actor of actors) {
    const { clusterId, clusterType } = resolveClusterId(actor);
    
    const existing = clusterMap.get(clusterId);
    
    if (!existing) {
      clusterMap.set(clusterId, {
        clusterId,
        clusterType,
        clusterWeight: actor.weight,
        actorIds: [actor.actorId],
        actorTypes: [actor.actorType],
        sourceGroups: [actor.sourceGroup],
      });
      continue;
    }
    
    // Aggregate into existing cluster
    existing.clusterWeight += actor.weight;
    existing.actorIds.push(actor.actorId);
    existing.actorTypes.push(actor.actorType);
    existing.sourceGroups.push(actor.sourceGroup);
  }
  
  // De-duplicate arrays and return
  return Array.from(clusterMap.values()).map(cluster => ({
    ...cluster,
    actorTypes: Array.from(new Set(cluster.actorTypes)),
    sourceGroups: Array.from(new Set(cluster.sourceGroups)),
  }));
}

/**
 * Calculate cluster diversity metrics
 */
export function calculateClusterDiversity(clusters: ActorCluster[]): {
  avgActorsPerCluster: number;
  avgUniqueTypes: number;
  avgSourceGroups: number;
} {
  if (clusters.length === 0) {
    return { avgActorsPerCluster: 0, avgUniqueTypes: 0, avgSourceGroups: 0 };
  }
  
  const avgActorsPerCluster = clusters.reduce((s, c) => s + c.actorIds.length, 0) / clusters.length;
  const avgUniqueTypes = clusters.reduce((s, c) => s + c.actorTypes.length, 0) / clusters.length;
  const avgSourceGroups = clusters.reduce((s, c) => s + c.sourceGroups.length, 0) / clusters.length;
  
  return {
    avgActorsPerCluster: Math.round(avgActorsPerCluster * 100) / 100,
    avgUniqueTypes: Math.round(avgUniqueTypes * 100) / 100,
    avgSourceGroups: Math.round(avgSourceGroups * 100) / 100,
  };
}

/**
 * Check if clusters represent real independence
 */
export function validateClusterIndependence(clusters: ActorCluster[]): {
  isIndependent: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  
  // Check for infra-only clusters
  const infraClusters = clusters.filter(c => c.clusterType === 'infra');
  if (infraClusters.length === clusters.length && clusters.length > 0) {
    warnings.push('All clusters are infrastructure-based');
  }
  
  // Check for single-actor clusters dominating
  const singleActorClusters = clusters.filter(c => c.actorIds.length === 1);
  if (singleActorClusters.length === clusters.length && clusters.length > 1) {
    warnings.push('All clusters are single-actor (may lack real confirmation)');
  }
  
  // Check for same sourceGroup across all clusters
  const allSourceGroups = new Set(clusters.flatMap(c => c.sourceGroups));
  if (allSourceGroups.size === 1 && clusters.length > 1) {
    warnings.push('All clusters share same source group');
  }
  
  return {
    isIndependent: warnings.length === 0,
    warnings,
  };
}
