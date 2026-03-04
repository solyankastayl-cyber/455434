/**
 * Self-Learning Types
 * 
 * ETAP 5: Type definitions for self-learning loop.
 */

// ==================== CONSTANTS ====================

export const SELF_LEARNING_CONSTANTS = {
  // Retraining
  MIN_NEW_SAMPLES: 200,
  COOLDOWN_DAYS: 7,
  
  // Auto-rollback
  PRECISION_DROP_THRESHOLD: 0.10, // 10%
  FALSE_BUY_RATE_INCREASE_THRESHOLD: 0.10, // 10%
  
  // ML Modifier
  ML_MODIFIER_MIN: 0.8,
  ML_MODIFIER_MAX: 1.2,
  
  // Drift modifiers
  DRIFT_MODIFIERS: {
    LOW: 1.0,
    MEDIUM: 0.85,
    HIGH: 0.6,
    CRITICAL: 0.3,
  } as const,
  
  // Promotion thresholds
  PRECISION_IMPROVEMENT_MIN: 0.02, // +2%
  LIFT_IMPROVEMENT_MIN: 0.05, // +5%
  ECE_DEGRADATION_MAX: 0.02, // max +0.02
  
  // Horizons
  HORIZONS: ['7d', '30d'] as const,
} as const;

// ==================== TYPES ====================

export type Horizon = '7d' | '30d';
export type DriftLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type GateDecision = 'PROMOTE' | 'HOLD' | 'REJECT';
export type GuardDecision = 'ALLOW' | 'DENY';

// ==================== GUARD ====================

export interface GuardCheckResult {
  decision: GuardDecision;
  checks: {
    mlReady: { passed: boolean; value: string; reason?: string };
    drift: { passed: boolean; value: DriftLevel; reason?: string };
    newSamples: { passed: boolean; value: number; required: number; reason?: string };
    cooldown: { passed: boolean; daysSinceLast: number; required: number; reason?: string };
    datasetIntegrity: { passed: boolean; reason?: string };
  };
  blockedBy: string[];
  checkedAt: Date;
}

// ==================== RUNTIME ====================

export interface SelfLearningRuntimeConfig {
  enabled: boolean;
  mode: 'OFF' | 'SHADOW' | 'ACTIVE';
  horizons: Horizon[];
  
  // Schedule
  scheduleEnabled: boolean;
  scheduleCron: string; // e.g., "0 3 * * *" (daily 3am)
  
  // Last run info
  lastRetrainAt: Date | null;
  lastRetrainHorizon: Horizon | null;
  lastRetrainDecision: GateDecision | null;
  lastRetrainModelVersion: string | null;
  
  // Guards config (overridable)
  minNewSamples: number;
  cooldownDays: number;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ==================== DATASET VERSION ====================

export interface DatasetVersionFilters {
  trainEligible: boolean;
  trends: string[]; // ['TREND_UP', 'TREND_DOWN']
  driftLevels: DriftLevel[]; // ['LOW', 'MEDIUM']
  minConfidence?: number;
}

export interface DatasetVersion {
  datasetVersion: string; // e.g., "ds_7d_20260121_030000"
  horizon: Horizon;
  
  // Content
  sampleIds: string[]; // snapshot IDs included
  sampleCount: number;
  filters: DatasetVersionFilters;
  
  // Integrity
  contentHash: string; // SHA256 of sorted sample IDs + filters
  
  // Class distribution
  classDistribution: {
    positive: number;
    negative: number;
    ratio: number;
  };
  
  // Time range
  earliestSample: Date;
  latestSample: Date;
  
  // Metadata
  createdAt: Date;
  createdBy: 'scheduler' | 'manual';
  
  // Status
  status: 'FROZEN' | 'USED' | 'EXPIRED';
  usedByModelVersion?: string;
}

// ==================== MODEL VERSION ====================

export interface ModelHyperparams {
  algorithm: 'lightgbm';
  numLeaves: number;
  learningRate: number;
  numIterations: number;
  featureFraction: number;
  baggingFraction: number;
  scalePositiveWeight: number;
}

export interface ModelVersion {
  modelVersion: string; // e.g., "model_7d_v1.0.0_20260121"
  horizon: Horizon;
  
  // Lineage
  datasetVersion: string;
  previousModelVersion: string | null;
  
  // Training
  hyperparams: ModelHyperparams;
  trainTimestamp: Date;
  trainDurationMs: number;
  
  // Artifact
  artifactPath: string;
  artifactSize: number;
  
  // Metrics (from training)
  trainingMetrics: {
    precision: number;
    recall: number;
    f1: number;
    prAuc: number;
    logLoss: number;
    brierScore: number;
  };
  
  // Status
  status: 'TRAINED' | 'EVALUATING' | 'PROMOTED' | 'REJECTED' | 'ROLLED_BACK';
  promotedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ==================== EVALUATION ====================

export interface ModelEvaluationMetrics {
  // Classification
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  
  // Ranking
  prAuc: number;
  rocAuc: number;
  lift: number;
  
  // Calibration
  ece: number; // Expected Calibration Error
  brierScore: number;
  
  // Error analysis
  falseBuyRate: number;
  missedBuyRate: number;
  
  // Coverage
  coverage: number; // % of samples with predictions
  sampleCount: number;
}

export interface ModelEvaluationReport {
  reportId: string;
  modelVersion: string;
  datasetVersion: string;
  horizon: Horizon;
  
  // Metrics
  metrics: ModelEvaluationMetrics;
  
  // Baseline comparison
  baseline: {
    source: 'rules' | 'previous_model';
    modelVersion?: string;
    metrics: Partial<ModelEvaluationMetrics>;
  };
  
  // Deltas
  deltas: {
    precision: number;
    lift: number;
    ece: number;
    falseBuyRate: number;
  };
  
  // Gate decision
  gateDecision: GateDecision;
  gateReasons: string[];
  
  // Confidence
  confidenceInterval: {
    precision: [number, number];
    lift: [number, number];
  };
  
  // Timestamps
  evaluatedAt: Date;
}

// ==================== AUDIT ====================

export interface SelfLearningAuditEntry {
  auditId: string;
  
  // Context
  tokenAddress: string;
  snapshotId: string;
  horizon: Horizon;
  timestamp: Date;
  
  // Model info
  modelVersion: string;
  datasetVersion: string;
  
  // Confidence calculation
  ruleConfidence: number;
  driftLevel: DriftLevel;
  driftModifier: number;
  mlPrediction: number;
  mlModifier: number;
  finalConfidence: number;
  
  // Decision context
  bucket: 'BUY' | 'WATCH' | 'SELL';
  compositeScore: number;
  
  // Gate info at time
  currentGateDecision: GateDecision;
  
  createdAt: Date;
}

// ==================== WORKER ====================

export interface RetrainWorkerResult {
  success: boolean;
  horizon: Horizon;
  
  // Guard
  guardResult: GuardCheckResult;
  
  // If training happened
  datasetVersion?: string;
  modelVersion?: string;
  
  // Evaluation
  evaluationReport?: ModelEvaluationReport;
  
  // Final decision
  gateDecision?: GateDecision;
  
  // Timing
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  
  // Error
  error?: string;
}
