/**
 * PHASE 3 — ML Types
 * ===================
 * Confidence calibration contracts
 */

export type SymbolId = string;
export type TruthLabel = 0 | 1; // 1 = confirmed, 0 = diverged

export interface MlDatasetRow {
  _id?: string;
  symbol: SymbolId;
  t0: number;
  t1: number;
  horizonBars: number;
  features: Record<string, number>;
  y: TruthLabel;
  rawConfidence?: number;
  predictedDirection?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  sourceMeta?: {
    dataMode: 'LIVE' | 'MIXED' | 'MOCK';
    providers?: string[];
  };
}

export interface SplitSet<T> {
  train: T[];
  val: T[];
  test: T[];
}

export interface TrainConfig {
  symbols?: string[];
  from?: number;
  to?: number;
  horizonBars?: number;
  split?: { train: number; val: number; test: number };
  minRows?: number;
}

export interface FeatureMatrix {
  X: number[][];
  y: number[];
  featureNames: string[];
}

export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  brierScore: number;
  calibrationError: number;
  sampleSize: number;
}

export interface TrainedModel {
  modelType: 'LOGREG' | 'TREE';
  version: string;
  trainedAt: Date;
  metrics: ModelMetrics;
  featureNames: string[];
  // LogReg specific
  weights?: number[];
  bias?: number;
  // Tree specific
  tree?: any;
  // Scaler
  scaler?: { mean: number[]; std: number[] };
}

export interface MlCalibrationResult {
  rawConfidence: number;
  calibratedConfidence: number;
  errorProbability: number;
  model: 'LOGREG' | 'TREE';
  driftWarning?: boolean;
}

console.log('[Phase 3] ML Types loaded');
