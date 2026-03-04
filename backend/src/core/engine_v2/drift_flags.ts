/**
 * Engine V2: Drift Flags Calculator
 * 
 * Detects data quality drift indicators
 */
import type { CoverageFeatures } from './coverage_features.js';
import type { EngineWindow } from './signals_fetcher.js';

/**
 * Compute drift flags based on feature anomalies
 */
export function computeDriftFlags(
  features: CoverageFeatures, 
  window: EngineWindow
): string[] {
  const flags: string[] = [];
  
  if (features.totalSignals === 0) {
    flags.push('no_data');
    return flags;
  }
  
  if (window !== '7d') {
    // Short-window sanity checks
    if (features.penaltyRate > 0.5) {
      flags.push('penalty_spike');
    }
    if (features.avgDominance > 0.9) {
      flags.push('dominance_extreme');
    }
    if (features.clusterPassRate < 0.35) {
      flags.push('cluster_collapse');
    }
    if (features.uniqueActors === 0) {
      flags.push('no_actors');
    }
  } else {
    // Longer window drift hints
    if (features.penaltyRate > 0.35) {
      flags.push('penalty_high_7d');
    }
    if (features.avgDominance > 0.85) {
      flags.push('dominance_creep_7d');
    }
    if (features.clusterPassRate < 0.55) {
      flags.push('cluster_pass_low_7d');
    }
  }
  
  // Universal checks
  if (features.highConfidenceRate < 0.1 && features.totalSignals >= 3) {
    flags.push('low_confidence_all');
  }
  
  return flags;
}
