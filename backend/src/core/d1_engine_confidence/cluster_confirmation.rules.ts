/**
 * P2.B.1 — Cluster Confirmation Rules
 * 
 * Rules for multi-cluster confirmation to prevent manipulation:
 * 
 * Rule B1: Multi-Cluster Confirmation
 *   - clustersCount >= 2
 *   - totalWeight >= 1.2
 *   - topClusterDominance <= 0.75
 *   - sourceGroupDiversity >= 2
 * 
 * Rule B2: Cluster Dominance Penalty
 *   - dominance > 0.85 → penalty 0.70
 *   - dominance > 0.70 → penalty 0.85
 * 
 * Rule B3: Cluster Diversity Penalty
 *   - avgUniqueTypes < 1.2 → penalty 0.85
 * 
 * Rule B4: Same-Source Rejection
 *   - If all clusters from same sourceGroup → cannot be HIGH
 */

import type { 
  ActorCluster, 
  ClusterConfirmationResult,
  ClusterResolutionTrace,
} from './cluster_confirmation.types.js';
import { CLUSTER_THRESHOLDS, CLUSTER_PENALTIES } from './cluster_confirmation.types.js';
import { buildResolutionTrace } from './cluster_resolver.js';
import type { ActorForCluster } from './cluster_confirmation.types.js';

/**
 * Evaluate cluster confirmation rules
 * 
 * Returns confirmation result with pass/fail, penalties, and trace.
 */
export function evaluateClusterConfirmation(
  clusters: ActorCluster[],
  actors: ActorForCluster[] = []
): ClusterConfirmationResult {
  const penalties: string[] = [];
  const t = CLUSTER_THRESHOLDS;
  
  // Basic metrics
  const clustersCount = clusters.length;
  const totalClusterWeight = clusters.reduce((s, c) => s + c.clusterWeight, 0);
  
  // Sort by weight descending
  const sorted = [...clusters].sort((a, b) => b.clusterWeight - a.clusterWeight);
  const topClusterWeight = sorted[0]?.clusterWeight ?? 0;
  
  // Calculate dominance
  const dominance = totalClusterWeight > 0 
    ? topClusterWeight / totalClusterWeight 
    : 1;
  
  // Collect all source groups
  const sourceGroups = Array.from(new Set(clusters.flatMap(c => c.sourceGroups)));
  
  // Build resolution trace
  const resolutionTrace = actors.length > 0 ? buildResolutionTrace(actors) : [];
  
  // ============ RULE B1: Multi-Cluster Confirmation ============
  let passed = true;
  let failReason: string | undefined;
  
  if (clustersCount < t.minClusters) {
    passed = false;
    failReason = `clustersCount=${clustersCount}<${t.minClusters}`;
  } else if (totalClusterWeight < t.minTotalWeight) {
    passed = false;
    failReason = `totalWeight=${totalClusterWeight.toFixed(2)}<${t.minTotalWeight}`;
  } else if (sourceGroups.length < t.minSourceGroups) {
    passed = false;
    failReason = `sourceGroups=${sourceGroups.length}<${t.minSourceGroups}`;
  } else if (dominance > t.maxTopClusterDominance) {
    // Still can pass but with strong penalty
    penalties.push('cluster_dominance_high');
  }
  
  // ============ RULE B2: Dominance Penalty ============
  if (dominance > t.dominanceStrongThreshold) {
    penalties.push('cluster_dominance_penalty_strong');
  } else if (dominance > t.dominanceSoftThreshold) {
    penalties.push('cluster_dominance_penalty_soft');
  }
  
  // ============ RULE B3: Diversity Penalty ============
  const avgUniqueTypes = clustersCount > 0
    ? clusters.reduce((s, c) => s + (c.actorTypes?.length ?? 0), 0) / clustersCount
    : 0;
  
  if (avgUniqueTypes < t.minAvgUniqueTypes) {
    penalties.push('cluster_diversity_penalty');
  }
  
  // ============ RULE B4: Same-Source Rejection ============
  if (sourceGroups.length === 1 && clustersCount >= 2) {
    // Multiple clusters but all from same source = suspicious
    penalties.push('same_source_clusters');
    if (passed) {
      passed = false;
      failReason = 'All clusters from same source group';
    }
  }
  
  // ============ Infrastructure Detection ============
  const infraClusters = clusters.filter(c => c.clusterType === 'infra');
  if (infraClusters.length > 0) {
    penalties.push('infra_cluster_detected');
  }
  
  // Mark confirmation as failed if didn't pass
  if (!passed) {
    penalties.push('cluster_confirmation_failed');
  }
  
  return {
    clusters,
    clustersCount,
    totalClusterWeight: Math.round(totalClusterWeight * 1000) / 1000,
    topClusterWeight: Math.round(topClusterWeight * 1000) / 1000,
    dominance: Math.round(dominance * 1000) / 1000,
    sourceGroups,
    passed,
    failReason,
    penalties,
    resolutionTrace,
  };
}

/**
 * Apply cluster penalties to confidence score
 */
export function applyClusterPenalties(
  confidence: number,
  penalties: string[]
): { 
  adjustedConfidence: number; 
  appliedPenalties: Array<{ penalty: string; multiplier: number; impact: number }>;
} {
  let adjustedConfidence = confidence;
  const appliedPenalties: Array<{ penalty: string; multiplier: number; impact: number }> = [];
  
  // Apply dominance penalties (mutually exclusive - use strongest)
  if (penalties.includes('cluster_dominance_penalty_strong')) {
    const multiplier = CLUSTER_PENALTIES.dominance_strong;
    const impact = Math.round(adjustedConfidence * (1 - multiplier));
    adjustedConfidence = Math.round(adjustedConfidence * multiplier);
    appliedPenalties.push({ penalty: 'cluster_dominance_penalty_strong', multiplier, impact });
  } else if (penalties.includes('cluster_dominance_penalty_soft')) {
    const multiplier = CLUSTER_PENALTIES.dominance_soft;
    const impact = Math.round(adjustedConfidence * (1 - multiplier));
    adjustedConfidence = Math.round(adjustedConfidence * multiplier);
    appliedPenalties.push({ penalty: 'cluster_dominance_penalty_soft', multiplier, impact });
  }
  
  // Apply diversity penalty
  if (penalties.includes('cluster_diversity_penalty')) {
    const multiplier = CLUSTER_PENALTIES.cluster_diversity;
    const impact = Math.round(adjustedConfidence * (1 - multiplier));
    adjustedConfidence = Math.round(adjustedConfidence * multiplier);
    appliedPenalties.push({ penalty: 'cluster_diversity_penalty', multiplier, impact });
  }
  
  // Apply confirmation cap (hard limit)
  if (penalties.includes('cluster_confirmation_failed')) {
    const cap = CLUSTER_PENALTIES.confirmation_cap;
    if (adjustedConfidence > cap) {
      const impact = adjustedConfidence - cap;
      adjustedConfidence = cap;
      appliedPenalties.push({ penalty: 'cluster_confirmation_cap', multiplier: 0, impact });
    }
  }
  
  return { adjustedConfidence, appliedPenalties };
}

/**
 * Get human-readable explanation for penalties
 */
export function explainClusterPenalties(penalties: string[]): string[] {
  const explanations: string[] = [];
  
  if (penalties.includes('cluster_confirmation_failed')) {
    explanations.push('Multi-cluster confirmation failed (need ≥2 independent clusters)');
  }
  
  if (penalties.includes('cluster_dominance_penalty_strong')) {
    explanations.push('Single cluster dominates >85% of total weight');
  } else if (penalties.includes('cluster_dominance_penalty_soft')) {
    explanations.push('Single cluster dominates >70% of total weight');
  }
  
  if (penalties.includes('cluster_diversity_penalty')) {
    explanations.push('Low actor type diversity within clusters');
  }
  
  if (penalties.includes('same_source_clusters')) {
    explanations.push('All clusters from same data source');
  }
  
  if (penalties.includes('infra_cluster_detected')) {
    explanations.push('Infrastructure cluster detected (CEX/Bridge)');
  }
  
  return explanations;
}
