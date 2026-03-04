/**
 * Training Stability Types - P1.1
 * 
 * Types for multi-seed training stability analysis
 */

export type StabilityVerdict = 'STABLE' | 'UNSTABLE' | 'INCONCLUSIVE';

export interface StabilityRunRequest {
  task: 'market' | 'actor';
  network: string;
  featurePack: string;
  datasetId: string;
  runs?: number;          // default 5
  seeds?: number[];       // optional explicit seeds
}

export interface StabilityMetrics {
  seed: number;
  modelId: string;
  accuracy: number;
  f1: number;
  precision: number;
  recall: number;
  trainMs?: number;
}

export interface StabilityStats {
  mean: { accuracy: number; f1: number };
  std: { accuracy: number; f1: number };
  cv: { accuracy: number; f1: number }; // coefficient of variation: std/mean
}

export interface StabilityRunResult {
  task: string;
  network: string;
  featurePack: string;
  datasetId: string;

  runsRequested: number;
  runsCompleted: number;

  metrics: StabilityMetrics[];
  stats: StabilityStats;

  verdict: StabilityVerdict;
  reasons: string[];

  createdAt: string;
}

/**
 * Final decision combining ablation + stability
 */
export type FinalDecision = 
  | 'ACCEPT'           // IMPROVES + STABLE → use in production
  | 'EXPERIMENT_ONLY'  // IMPROVES + UNSTABLE → needs more work
  | 'IGNORE'           // NEUTRAL → no value
  | 'REJECT'           // DEGRADES → harmful
  | 'INCONCLUSIVE';    // Not enough data
