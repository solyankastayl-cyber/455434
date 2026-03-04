/**
 * ML Runtime Configuration (Block F5.0)
 * 
 * Defines ML runtime modes and rules:
 * - OFF: ML disabled
 * - SHADOW: ML computes & logs, no influence
 * - ASSIST: ML can adjust ranking within bucket (±10) - requires LIVE data
 * - ADVISOR: ML shows suggestions - requires LIVE data
 * 
 * Priority: Kill Switch > Runtime Toggle > Default OFF
 */
import mongoose, { Schema } from 'mongoose';

// ============================================================
// ML RUNTIME MODES
// ============================================================

export type MLRuntimeMode = 'OFF' | 'SHADOW' | 'ASSIST' | 'ADVISOR';

export const ML_MODE_REQUIREMENTS = {
  OFF: {
    minLiveSamples: 0,
    minBuyBucket: false,
    driftStatus: [] as string[],
  },
  SHADOW: {
    minLiveSamples: 0, // Can run with only SIM data
    minBuyBucket: false,
    driftStatus: ['OK', 'WARN', 'N/A'],
  },
  ASSIST: {
    minLiveSamples: 300,
    minBuyBucket: true, // Needs BUY samples to avoid bucket bias
    driftStatus: ['OK'],
  },
  ADVISOR: {
    minLiveSamples: 300,
    minBuyBucket: true,
    driftStatus: ['OK'],
  },
} as const;

// ============================================================
// ML RUNTIME STATE MODEL
// ============================================================

export interface IMLRuntimeState {
  // Current state
  mode: MLRuntimeMode;
  enabled: boolean;
  
  // Kill switch
  killSwitchTriggered: boolean;
  killSwitchReason?: string;
  killSwitchAt?: Date;
  
  // Model info
  modelVersion?: string;
  modelTrainedAt?: Date;
  modelDatasetSize?: number;
  
  // Health metrics
  lastInferenceAt?: Date;
  inferenceErrorRate: number;
  inferenceLatencyP95: number;
  predictionDrift: number;
  
  // Permissions
  allowedModes: MLRuntimeMode[];
  blockedModes: { mode: MLRuntimeMode; reason: string }[];
  
  // Metadata
  updatedAt: Date;
  updatedBy: string;
}

const MLRuntimeStateSchema = new Schema<IMLRuntimeState>({
  mode: { 
    type: String, 
    enum: ['OFF', 'SHADOW', 'ASSIST', 'ADVISOR'],
    default: 'OFF',
  },
  enabled: { type: Boolean, default: false },
  
  killSwitchTriggered: { type: Boolean, default: false },
  killSwitchReason: { type: String },
  killSwitchAt: { type: Date },
  
  modelVersion: { type: String },
  modelTrainedAt: { type: Date },
  modelDatasetSize: { type: Number },
  
  lastInferenceAt: { type: Date },
  inferenceErrorRate: { type: Number, default: 0 },
  inferenceLatencyP95: { type: Number, default: 0 },
  predictionDrift: { type: Number, default: 0 },
  
  allowedModes: [{ type: String, enum: ['OFF', 'SHADOW', 'ASSIST', 'ADVISOR'] }],
  blockedModes: [{
    mode: { type: String, enum: ['OFF', 'SHADOW', 'ASSIST', 'ADVISOR'] },
    reason: { type: String },
  }],
  
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: 'system' },
}, {
  collection: 'ml_runtime_state',
  timestamps: false,
});

export const MLRuntimeStateModel = mongoose.model<IMLRuntimeState>('MLRuntimeState', MLRuntimeStateSchema);

// ============================================================
// SHADOW PREDICTION MODEL (F5.3)
// ============================================================

export interface IShadowPrediction {
  // Token identity
  tokenAddress: string;
  symbol: string;
  
  // Timing
  timestamp: Date;
  windowType: '1h' | '6h' | '24h';
  
  // ML outputs (F5.2 scope)
  pSuccess: number;       // 0..1 probability of SUCCESS
  pFail: number;          // 0..1 probability of FAIL
  expectedDelta: number;  // Expected % change
  
  // Calibration suggestions (not applied)
  confidenceCalibrationDelta: number;  // Suggested confidence adjustment
  riskAdjustment: number;              // Suggested risk adjustment
  
  // Context at prediction time
  rulesDecision: {
    bucket: 'BUY' | 'WATCH' | 'SELL';
    confidence: number;
    risk: number;
    compositeScore: number;
  };
  
  // Features hash (for drift detection)
  inputHash: string;
  featuresSnapshot: Record<string, number>;
  
  // Model info
  modelVersion: string;
  
  // Performance
  latencyMs: number;
  errorFlag: boolean;
  errorMessage?: string;
  
  // Source
  source: 'live' | 'simulated';
  
  createdAt: Date;
}

const ShadowPredictionSchema = new Schema<IShadowPrediction>({
  tokenAddress: { type: String, required: true, lowercase: true, index: true },
  symbol: { type: String, required: true },
  
  timestamp: { type: Date, required: true, index: true },
  windowType: { type: String, enum: ['1h', '6h', '24h'], required: true },
  
  pSuccess: { type: Number, required: true, min: 0, max: 1 },
  pFail: { type: Number, required: true, min: 0, max: 1 },
  expectedDelta: { type: Number, required: true },
  
  confidenceCalibrationDelta: { type: Number, default: 0 },
  riskAdjustment: { type: Number, default: 0 },
  
  rulesDecision: {
    bucket: { type: String, enum: ['BUY', 'WATCH', 'SELL'], required: true },
    confidence: { type: Number, required: true },
    risk: { type: Number, required: true },
    compositeScore: { type: Number, required: true },
  },
  
  inputHash: { type: String, required: true },
  featuresSnapshot: { type: Schema.Types.Mixed, default: {} },
  
  modelVersion: { type: String, required: true },
  
  latencyMs: { type: Number, required: true },
  errorFlag: { type: Boolean, default: false },
  errorMessage: { type: String },
  
  source: { type: String, enum: ['live', 'simulated'], default: 'live' },
  
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'shadow_predictions',
  timestamps: false,
});

// Indexes
ShadowPredictionSchema.index({ tokenAddress: 1, timestamp: -1 });
ShadowPredictionSchema.index({ modelVersion: 1, timestamp: -1 });
ShadowPredictionSchema.index({ 'rulesDecision.bucket': 1, timestamp: -1 });

export const ShadowPredictionModel = mongoose.model<IShadowPrediction>('ShadowPrediction', ShadowPredictionSchema);

// ============================================================
// ML TRAINING JOB MODEL
// ============================================================

export interface IMLTrainingJob {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  
  // Dataset info
  datasetSize: number;
  datasetTimeRange: { start: Date; end: Date };
  bucketDistribution: { BUY: number; WATCH: number; SELL: number };
  labelDistribution: { SUCCESS: number; FLAT: number; FAIL: number };
  
  // Model output
  modelVersion?: string;
  modelPath?: string;
  
  // Metrics after training
  metrics?: {
    accuracy: number;
    aucSuccess: number;
    aucFail: number;
    calibrationError: number;
    mse: number;
  };
  
  // Timing
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  
  // Errors
  errorMessage?: string;
  
  createdAt: Date;
}

const MLTrainingJobSchema = new Schema<IMLTrainingJob>({
  jobId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'running', 'completed', 'failed'], default: 'pending' },
  
  datasetSize: { type: Number, required: true },
  datasetTimeRange: {
    start: { type: Date },
    end: { type: Date },
  },
  bucketDistribution: {
    BUY: { type: Number, default: 0 },
    WATCH: { type: Number, default: 0 },
    SELL: { type: Number, default: 0 },
  },
  labelDistribution: {
    SUCCESS: { type: Number, default: 0 },
    FLAT: { type: Number, default: 0 },
    FAIL: { type: Number, default: 0 },
  },
  
  modelVersion: { type: String },
  modelPath: { type: String },
  
  metrics: {
    accuracy: { type: Number },
    aucSuccess: { type: Number },
    aucFail: { type: Number },
    calibrationError: { type: Number },
    mse: { type: Number },
  },
  
  startedAt: { type: Date },
  completedAt: { type: Date },
  durationMs: { type: Number },
  
  errorMessage: { type: String },
  
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'ml_training_jobs',
  timestamps: false,
});

export const MLTrainingJobModel = mongoose.model<IMLTrainingJob>('MLTrainingJob', MLTrainingJobSchema);

// ============================================================
// ML EVALUATION RESULT MODEL (F5.4)
// ============================================================

export interface IMLEvaluationResult {
  evalId: string;
  modelVersion: string;
  
  // Dataset used
  datasetType: 'sim' | 'live' | 'mixed';
  sampleCount: number;
  timeRange: { start: Date; end: Date };
  
  // Offline metrics
  offlineMetrics: {
    accuracy: number;
    aucSuccessVsFail: number;
    calibrationECE: number;
    calibrationBrier: number;
    stabilityVariance: number;
    latencyP95: number;
  };
  
  // By-bucket metrics
  bucketMetrics: {
    bucket: 'BUY' | 'WATCH' | 'SELL';
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    sampleCount: number;
  }[];
  
  // Consistency metrics
  consistencyMetrics: {
    predictionDriftDayToDay: number;
    coverageRate: number;
    errorRate: number;
  };
  
  // Verdict
  verdict: 'PASS' | 'NEEDS_REVIEW' | 'FAIL';
  verdictReasons: string[];
  
  // Can we promote?
  canPromote: boolean;
  promotionBlockers: string[];
  
  createdAt: Date;
}

const MLEvaluationResultSchema = new Schema<IMLEvaluationResult>({
  evalId: { type: String, required: true, unique: true },
  modelVersion: { type: String, required: true, index: true },
  
  datasetType: { type: String, enum: ['sim', 'live', 'mixed'], required: true },
  sampleCount: { type: Number, required: true },
  timeRange: {
    start: { type: Date },
    end: { type: Date },
  },
  
  offlineMetrics: {
    accuracy: { type: Number },
    aucSuccessVsFail: { type: Number },
    calibrationECE: { type: Number },
    calibrationBrier: { type: Number },
    stabilityVariance: { type: Number },
    latencyP95: { type: Number },
  },
  
  bucketMetrics: [{
    bucket: { type: String, enum: ['BUY', 'WATCH', 'SELL'] },
    accuracy: { type: Number },
    precision: { type: Number },
    recall: { type: Number },
    f1: { type: Number },
    sampleCount: { type: Number },
  }],
  
  consistencyMetrics: {
    predictionDriftDayToDay: { type: Number },
    coverageRate: { type: Number },
    errorRate: { type: Number },
  },
  
  verdict: { type: String, enum: ['PASS', 'NEEDS_REVIEW', 'FAIL'], required: true },
  verdictReasons: [{ type: String }],
  
  canPromote: { type: Boolean, default: false },
  promotionBlockers: [{ type: String }],
  
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'ml_evaluation_results',
  timestamps: false,
});

MLEvaluationResultSchema.index({ modelVersion: 1, createdAt: -1 });

export const MLEvaluationResultModel = mongoose.model<IMLEvaluationResult>('MLEvaluationResult', MLEvaluationResultSchema);
