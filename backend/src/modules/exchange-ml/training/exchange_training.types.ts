/**
 * Exchange Auto-Learning Loop - PR2: Training Types
 * 
 * Types for model training, versioning and registry.
 */

import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// MODEL TYPES
// ═══════════════════════════════════════════════════════════════

export type ModelAlgo = 'LOGISTIC_REGRESSION' | 'DECISION_TREE' | 'RANDOM_FOREST' | 'GRADIENT_BOOST';
export type ModelStatus = 'TRAINING' | 'READY' | 'ACTIVE' | 'SHADOW' | 'RETIRED' | 'FAILED';

// ═══════════════════════════════════════════════════════════════
// MODEL DOCUMENT (exch_models collection)
// ═══════════════════════════════════════════════════════════════

export interface ExchangeModel {
  _id?: string;
  modelId: string;                 // Unique ID: {horizon}_{algo}_{timestamp}
  
  // Model metadata
  horizon: ExchangeHorizon;
  algo: ModelAlgo;
  version: number;                 // Auto-incremented per horizon
  status: ModelStatus;
  
  // Training details
  trainingRunId: string;           // Reference to exch_training_runs
  trainedAt: Date;
  
  // Dataset info
  datasetInfo: {
    totalSamples: number;
    trainSize: number;
    validSize: number;
    testSize: number;
    dateRange: {
      from: Date;
      to: Date;
    };
  };
  
  // Performance metrics
  metrics: ModelMetrics;
  
  // Model artifact (serialized weights/parameters)
  artifact: ModelArtifact;
  
  // Feature configuration
  featureConfig: {
    version: string;
    features: string[];
    normalization: Record<string, { mean: number; std: number }>;
  };
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  promotedAt: Date | null;
  retiredAt: Date | null;
}

// ═══════════════════════════════════════════════════════════════
// MODEL METRICS
// ═══════════════════════════════════════════════════════════════

export interface ModelMetrics {
  // Classification metrics
  accuracy: number;                // Overall accuracy
  precision: number;               // Precision for WIN class
  recall: number;                  // Recall for WIN class
  f1Score: number;                 // F1 score
  
  // Calibration metrics
  winRate: number;                 // Actual win rate in predictions
  expectedWinRate: number;         // Expected based on confidence
  brierScore: number;              // Brier score (lower is better)
  
  // Per-class metrics
  classMetrics: {
    WIN: { precision: number; recall: number; support: number };
    LOSS: { precision: number; recall: number; support: number };
    NEUTRAL: { precision: number; recall: number; support: number };
  };
  
  // Confusion matrix
  confusionMatrix: number[][];     // 3x3 matrix [actual][predicted]
  
  // ROC/AUC (if applicable)
  auc?: number;
}

// ═══════════════════════════════════════════════════════════════
// MODEL ARTIFACT
// ═══════════════════════════════════════════════════════════════

export interface ModelArtifact {
  type: ModelAlgo;
  
  // For Logistic Regression
  weights?: number[];
  bias?: number;
  
  // For Decision Tree / Random Forest / Gradient Boost
  tree?: any;                      // Serialized tree structure
  trees?: any[];                   // For ensemble methods
  
  // Thresholds
  thresholds: {
    winThreshold: number;          // Confidence threshold for WIN
    lossThreshold: number;         // Confidence threshold for LOSS
  };
}

// ═══════════════════════════════════════════════════════════════
// TRAINING RUN (exch_training_runs collection)
// ═══════════════════════════════════════════════════════════════

export type TrainingRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ExchangeTrainingRun {
  _id?: string;
  runId: string;                   // Unique ID
  
  // Run configuration
  horizon: ExchangeHorizon;
  algo: ModelAlgo;
  trigger: 'MANUAL' | 'SCHEDULED' | 'THRESHOLD';
  
  // Status tracking
  status: TrainingRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  
  // Progress
  progress: {
    phase: 'LOADING' | 'SPLITTING' | 'TRAINING' | 'EVALUATING' | 'SAVING';
    percent: number;
    message: string;
  };
  
  // Dataset stats
  datasetStats?: {
    totalSamples: number;
    trainSize: number;
    validSize: number;
    testSize: number;
    labelDistribution: Record<string, number>;
  };
  
  // Result
  resultModelId?: string;          // Created model ID (if successful)
  metrics?: ModelMetrics;          // Final metrics
  error?: string;                  // Error message (if failed)
  
  // Duration
  durationMs?: number;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// MODEL REGISTRY (exch_model_registry collection)
// ═══════════════════════════════════════════════════════════════

export interface ExchangeModelRegistry {
  _id?: string;
  horizon: ExchangeHorizon;        // One registry per horizon
  
  // Active model pointer
  activeModelId: string | null;
  activeModelVersion: number;
  
  // Shadow model (candidate for promotion)
  shadowModelId: string | null;
  
  // Previous model (for rollback)
  prevModelId: string | null;
  prevModelVersion: number | null;
  
  // Timestamps
  lastPromotionAt: Date | null;
  lastRollbackAt: Date | null;
  lastRetrainAt: Date | null;
  
  // Stats
  totalVersions: number;
  totalPromotions: number;
  totalRollbacks: number;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// TRAINER CONFIG
// ═══════════════════════════════════════════════════════════════

export interface TrainerConfig {
  // Dataset split
  trainRatio: number;              // e.g., 0.7
  validRatio: number;              // e.g., 0.15
  testRatio: number;               // e.g., 0.15
  minSamples: number;              // Minimum samples required
  
  // Model config
  defaultAlgo: ModelAlgo;
  
  // Logistic Regression config
  logisticRegression: {
    learningRate: number;
    epochs: number;
    regularization: number;        // L2 regularization
    earlyStopPatience: number;
  };
  
  // Thresholds
  winThreshold: number;            // Default: 0.6
  lossThreshold: number;           // Default: 0.4
}

export const DEFAULT_TRAINER_CONFIG: TrainerConfig = {
  trainRatio: 0.7,
  validRatio: 0.15,
  testRatio: 0.15,
  minSamples: 100,                 // Reduced for testing, production: 500
  
  defaultAlgo: 'LOGISTIC_REGRESSION',
  
  logisticRegression: {
    learningRate: 0.01,
    epochs: 100,
    regularization: 0.1,
    earlyStopPatience: 10,
  },
  
  winThreshold: 0.6,
  lossThreshold: 0.4,
};

// ═══════════════════════════════════════════════════════════════
// RETRAIN SCHEDULER CONFIG
// ═══════════════════════════════════════════════════════════════

export interface RetrainSchedulerConfig {
  // Trigger conditions
  minNewSamples: number;           // Min new samples since last train
  cooldownMs: number;              // Min time between retrains
  
  // Schedule (cron-like)
  cronEnabled: boolean;
  cronExpression: string;          // e.g., "0 */6 * * *" (every 6 hours)
  
  // Auto-start
  autoStart: boolean;
}

export const DEFAULT_RETRAIN_CONFIG: RetrainSchedulerConfig = {
  minNewSamples: 100,              // Reduced for testing
  cooldownMs: 6 * 60 * 60 * 1000,  // 6 hours
  cronEnabled: false,
  cronExpression: '0 */6 * * *',
  autoStart: false,
};

console.log('[Exchange ML] Training types loaded');
