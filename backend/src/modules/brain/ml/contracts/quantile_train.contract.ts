/**
 * P8.0-B2 — Quantile Train Contract
 * 
 * Defines the structure for training data, model weights, and storage.
 */

import { Horizon } from './quantile_forecast.contract.js';

// ═══════════════════════════════════════════════════════════════
// DATASET SAMPLE
// ═══════════════════════════════════════════════════════════════

export interface DatasetSample {
  asOf: string;
  expertRegime: string;         // argmax of regime probs at t
  features: number[];            // 53-dim feature vector
  labels: Record<Horizon, number>; // forward returns: log(P[t+h]/P[t])
}

// ═══════════════════════════════════════════════════════════════
// MODEL WEIGHTS
// ═══════════════════════════════════════════════════════════════

/** Weights for a single quantile of a single expert+horizon */
export interface QuantileWeights {
  w: number[];   // feature weights (53 elements)
  b: number;     // bias term
}

/** All quantile weights for one expert+horizon */
export interface ExpertHorizonWeights {
  q05: QuantileWeights;
  q50: QuantileWeights;
  q95: QuantileWeights;
}

/** Full trained model structure */
export interface TrainedModelWeights {
  modelVersion: string;
  asset: string;
  trainedAt: string;
  seed: number;
  smoothing: number;
  featureCount: number;
  horizons: Horizon[];
  experts: Record<string, Record<Horizon, ExpertHorizonWeights>>;
  droppedExperts: string[];
  stats: {
    totalSamples: number;
    perExpert: Record<string, number>;
    trainingTimeMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// MONGO STORAGE DOCUMENT
// ═══════════════════════════════════════════════════════════════

export interface ModelDocument {
  asset: string;
  modelVersion: string;
  weightsId: string;
  trainedAt: string;
  weights: TrainedModelWeights;
  active: boolean;
  createdAt: string;
}
