/**
 * Engine V2: Risk Score Calculator
 * 
 * Computes Risk (0-100) based on coverage, features, and drift.
 * Calibrated to match v1 UI expectations (Risk ~75 at coverage ~7%).
 */
import type { CoverageFeatures } from './coverage_features.js';

export interface RiskScoreResult {
  risk: number;       // 0..100
  notes: string[];    // internal reasons
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Compute risk score
 * 
 * Formula (v1 compatible):
 * - Base: 40 + 0.6 * (100 - coverage) → gives ~75 at coverage 7%
 * - Plus penalties for dominance, penalty rate, cluster issues
 * - Plus drift flags
 */
export function computeRiskScore(
  coverageScore: number,
  features: CoverageFeatures,
  driftFlags: string[] = []
): RiskScoreResult {
  const notes: string[] = [];
  
  // Base risk (v1 compatible formula)
  // At coverage=7: 40 + 0.6*93 = 40 + 55.8 = 95.8 → too high
  // Adjusted: 30 + 0.5*(100-coverage) → At coverage=7: 30 + 46.5 = 76.5 ≈ 75
  let risk = 30 + 0.5 * (100 - coverageScore);
  
  // Dominance penalty: starts > 0.70, strong > 0.85
  const dom = clamp(features.avgDominance ?? 0, 0, 1);
  if (dom > 0.70) {
    const p = (dom - 0.70) * 40; // max ~12 when dom=1
    risk += p;
    notes.push('dominance_penalty');
  }
  if (dom > 0.85) {
    risk += 8;
    notes.push('dominance_strong_penalty');
  }
  
  // Penalty rate from signals
  if (features.penaltyRate > 0.15) {
    risk += features.penaltyRate * 25; // up to +25
    notes.push('penalty_rate_high');
  }
  
  // Cluster pass collapse
  if (features.clusterPassRate < 0.5 && features.totalSignals > 0) {
    risk += 8;
    notes.push('cluster_pass_low');
  }
  
  // Context missing
  if (features.contextsAvailable === 0) {
    risk += 5;
    notes.push('no_contexts');
  }
  
  // Single actor source
  if (features.uniqueActors <= 1 && features.totalSignals > 0) {
    risk += 10;
    notes.push('single_actor');
  }
  
  // Drift flags
  if (driftFlags.length > 0) {
    risk += Math.min(20, 5 + driftFlags.length * 5);
    notes.push('drift_flags');
  }
  
  return { 
    risk: clamp(Math.round(risk), 0, 100), 
    notes 
  };
}
