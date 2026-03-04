/**
 * Phase 6: ML Training Domain Types
 */

// ═══════════════════════════════════════════════════════════════
// MODEL TYPES
// ═══════════════════════════════════════════════════════════════

export type ModelStage = 'SHADOW' | 'LIVE_LITE' | 'LIVE_MED' | 'LIVE_FULL';
export type ModelTask = 'WIN_PROB' | 'R_MULTIPLE';
export type DriftStatus = 'OK' | 'WARN' | 'DRIFT' | 'HARD_DRIFT';

export interface ModelArtifactRef {
  kind: 'LOCAL_FILE' | 'S3';
  path: string;
  checksumSha256: string;
}

export interface ModelMetrics {
  rows: number;
  featuresVersion: string;
  featuresCount: number;
  target: ModelTask;
  
  auc?: number;
  logloss?: number;
  brier?: number;
  ece?: number;
  rmse?: number;
  mae?: number;
}

export interface QualityGates {
  minRowsToEnable: number;
  minAucToEnable?: number;
  maxEceToEnable?: number;
  maxDeltaProb?: number;
}

export interface ModelRecord {
  modelId: string;
  createdAt: number;
  
  stage: ModelStage;
  enabled: boolean;
  
  symbolScope: 'GLOBAL' | 'SYMBOL_LIST';
  symbols?: string[];
  
  tfScope: 'GLOBAL' | 'TF_LIST';
  tfs?: string[];
  
  task: ModelTask;
  rThreshold?: number;
  
  artifact: ModelArtifactRef;
  metrics: ModelMetrics;
  gates: QualityGates;
  
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY TYPES
// ═══════════════════════════════════════════════════════════════

export interface OverlayRequest {
  symbol: string;
  tf: string;
  ts: number;
  baseProbability: number;
  features: Record<string, number>;
}

export interface OverlayResponse {
  ok: boolean;
  modelUsed?: string;
  stage: ModelStage;
  probabilitySource: 'BASE' | 'ML_SHADOW' | 'ML_LIVE';
  baseProbability: number;
  mlProbability?: number;
  finalProbability: number;
  delta: number;
  gatesApplied: string[];
  latencyMs: number;
}

// ═══════════════════════════════════════════════════════════════
// DRIFT TYPES
// ═══════════════════════════════════════════════════════════════

export interface FeaturePSI {
  [feature: string]: number;
}

export interface GroupPSI {
  geometry: number;
  structure: number;
  volatility: number;
  momentum: number;
  risk: number;
}

export interface DriftReport {
  ts: number;
  modelId: string;
  rowsBaseline: number;
  rowsCurrent: number;
  featurePSI: FeaturePSI;
  groupPSI: GroupPSI;
  driftScore: number;
  status: DriftStatus;
}

// ═══════════════════════════════════════════════════════════════
// PREDICTION LOG
// ═══════════════════════════════════════════════════════════════

export interface PredictionLog {
  ts: number;
  modelId: string;
  symbol: string;
  tf: string;
  scenarioId?: string;
  baseProbability: number;
  mlProbability: number;
  finalProbability: number;
  stage: ModelStage;
  outcomeKnown?: boolean;
  actualWin?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ROLLOUT TYPES
// ═══════════════════════════════════════════════════════════════

export interface RolloutCheck {
  canEnable: boolean;
  targetStage: ModelStage;
  reasons: string[];
  metrics: Partial<ModelMetrics>;
  drift?: DriftReport;
}

// ═══════════════════════════════════════════════════════════════
// TRAINING TYPES
// ═══════════════════════════════════════════════════════════════

export interface TrainRequest {
  datasetPath?: string;
  outputDir?: string;
  modelId?: string;
}

export interface TrainResult {
  ok: boolean;
  modelId: string;
  metrics: ModelMetrics;
  artifactPath: string;
  gatesPassed: boolean;
  error?: string;
}
