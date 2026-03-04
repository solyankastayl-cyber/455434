/**
 * Engine V2: Coverage Score Calculator
 * 
 * Computes coverage 0-100 based on signals features.
 * UI-compatible with current dashboard.
 */
import type { CoverageFeatures } from './coverage_features.js';

export interface CoverageScoreResult {
  score: number; // 0..100
  notes: string[];
}

/**
 * Compute coverage score from features
 * 
 * Formula:
 * Coverage = weighted sum of:
 * - 35% clusterAvailability (clusters present + passed)
 * - 25% sourceDiversity (multiple source groups)
 * - 25% contextsAvailability (context data available)
 * - 15% lifecycleValidity (active signals ratio)
 */
export function computeCoverageScore(features: CoverageFeatures): CoverageScoreResult {
  const notes: string[] = [];
  
  // No signals = no coverage
  if (features.totalSignals === 0) {
    return { score: 0, notes: ['no_signals'] };
  }
  
  // Component calculations
  
  // 1. Cluster availability: do we have cluster confirmations?
  // - clustersCountAvg / 2 = how many clusters per signal (normalized)
  // - clusterPassRate = what % passed
  const clusterNorm = Math.min(1, features.clustersCountAvg / 2);
  const clusterAvailability = clusterNorm * features.clusterPassRate;
  
  // 2. Source diversity: multiple actors/sources?
  // - sourceGroupsAvg / 2 = normalized source groups
  // - uniqueActors / 3 = normalized unique actors
  const sourceDiversity = Math.min(1, 
    (features.sourceGroupsAvg / 2 + features.uniqueActors / 3) / 2
  );
  
  // 3. Contexts availability (future - currently 0)
  const targetContexts = 3;
  const contextsAvailability = Math.min(1, features.contextsAvailable / targetContexts);
  
  // 4. Lifecycle validity: what % are active (not cooling/archived)?
  const lifecycleValidity = features.lifecycleActiveRate;
  
  // Weighted combination
  const weighted =
    0.35 * clusterAvailability +
    0.25 * sourceDiversity +
    0.25 * contextsAvailability +
    0.15 * lifecycleValidity;
  
  const score = Math.round(weighted * 100);
  
  // Generate notes
  if (score < 60) notes.push('low_coverage');
  if (sourceDiversity < 0.5) notes.push('single_source');
  if (clusterAvailability < 0.5) notes.push('weak_cluster_confirmation');
  if (contextsAvailability === 0) notes.push('no_contexts');
  if (features.uniqueActors <= 1) notes.push('single_actor_source');
  if (features.highConfidenceRate < 0.3) notes.push('low_confidence_signals');
  
  return { score, notes };
}
