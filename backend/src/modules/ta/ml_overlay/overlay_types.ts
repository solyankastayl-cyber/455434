/**
 * Phase L: ML Overlay Types
 * 
 * ML probability refinement layer with controlled rollout
 */

export type OverlayMode = 'OFF' | 'SHADOW' | 'LIVE_LITE' | 'LIVE_MED' | 'LIVE_FULL';

export interface OverlayConfig {
  mode: OverlayMode;
  mlAlpha: number;              // 0..1 blend weight (used only in LIVE_*)
  minRowsToEnable: number;      // safety gate
  minAucToEnable: number;       // safety gate (offline)
  maxDelta: number;             // clamp |p_ml - p_base|
  provider: 'mock' | 'local_joblib' | 'python_service';
  modelVersion: string;         // e.g. overlay_v1
}

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  mode: 'SHADOW',
  mlAlpha: 0.2,
  minRowsToEnable: 100,
  minAucToEnable: 0.55,
  maxDelta: 0.25,
  provider: 'mock',
  modelVersion: 'overlay_v1',
};

export interface OverlayInput {
  runId: string;
  scenarioId: string;
  asset: string;
  timeframe: string;

  // Base probability from calibration
  score: number;
  baseProbability: number;

  // Features for ML (must be leakage-safe)
  features: Record<string, number | string>;
}

export interface OverlayOutput {
  ok: true;
  mode: OverlayMode;
  modelVersion: string;

  pBase: number;
  pML: number;
  pFinal: number;
  alphaUsed: number;

  gated: boolean;
  gateReasons: string[];

  computedAt: number;
}

export interface ModelMetrics {
  auc: number;
  brier: number;
  rows_train: number;
  rows_val: number;
  positive_rate: number;
}

export interface LoadedModel {
  version: string;
  schema: {
    feature_order: string[];
  };
  metrics: ModelMetrics;
  artifactPath: string;
}

// MongoDB document for predictions audit
export interface MLPredictionDoc {
  runId: string;
  scenarioId: string;
  asset: string;
  timeframe: string;
  modelVersion: string;
  mode: OverlayMode;
  pBase: number;
  pML: number;
  pFinal: number;
  alphaUsed: number;
  gated: boolean;
  gateReasons: string[];
  computedAt: Date;
}

// MongoDB document for model registry
export interface MLModelDoc {
  version: string;
  provider: string;
  schema: any;
  metrics: ModelMetrics;
  artifactPath: string;
  status: 'active' | 'deprecated';
  createdAt: Date;
}
