/**
 * ML Model Version Model (ETAP 5.3)
 * 
 * Tracks candidate and active ML models.
 * Each retrain creates a new version - never overwrites.
 */
import mongoose from 'mongoose';
import crypto from 'crypto';

export type ModelStatus = 
  | 'CANDIDATE'      // Just trained, awaiting evaluation
  | 'APPROVED'       // Passed evaluation gate
  | 'REJECTED'       // Failed evaluation gate
  | 'ACTIVE'         // Currently serving in production
  | 'INACTIVE'       // Was active, now replaced
  | 'ROLLED_BACK';   // Was active, rolled back due to degradation

const MLModelVersionSchema = new mongoose.Schema({
  // ========== VERSION ID ==========
  modelId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    // Format: ml_7d_2026-01-21_001_<hash>
  },
  
  // ========== STATUS ==========
  status: {
    type: String,
    enum: ['CANDIDATE', 'APPROVED', 'REJECTED', 'ACTIVE', 'INACTIVE', 'ROLLED_BACK'],
    default: 'CANDIDATE',
    required: true,
    index: true,
  },
  
  // ========== HORIZON ==========
  horizon: {
    type: String,
    enum: ['7d', '30d'],
    required: true,
    index: true,
  },
  
  // ========== DATASET LINK ==========
  datasetVersionId: {
    type: String,
    required: true,
    index: true,
  },
  
  // ========== SCHEMA ==========
  featuresSchemaHash: {
    type: String,
    required: true,
    index: true,
  },
  
  featureCount: {
    type: Number,
    required: true,
  },
  
  featureNames: [{
    type: String,
  }],
  
  // ========== TRAINING META ==========
  trainingMeta: {
    trainSamples: { type: Number, required: true },
    evalSamples: { type: Number, required: true },
    liveShare: { type: Number, required: true },
    driftLevel: { type: String },
    timeRange: {
      from: Date,
      to: Date,
    },
    splitMethod: { type: String, default: 'time_based' },
    splitRatio: { type: Number, default: 0.8 },
  },
  
  // ========== HYPERPARAMETERS ==========
  hyperparameters: {
    algorithm: { type: String, required: true }, // 'logreg', 'lightgbm', etc.
    classWeight: { type: mongoose.Schema.Types.Mixed },
    regularization: { type: Number },
    maxDepth: { type: Number },
    learningRate: { type: Number },
    nEstimators: { type: Number },
    other: { type: mongoose.Schema.Types.Mixed },
  },
  
  // ========== TRAINING METRICS ==========
  trainMetrics: {
    precision: { type: Number },
    recall: { type: Number },
    f1: { type: Number },
    prAuc: { type: Number },
    roc: { type: Number },
    loss: { type: Number },
  },
  
  // ========== EVAL METRICS (from evaluation gate) ==========
  evalMetrics: {
    precision: { type: Number },
    recall: { type: Number },
    f1: { type: Number },
    prAuc: { type: Number },
    fpRate: { type: Number },
    calibrationError: { type: Number }, // ECE or Brier
    lift: { type: Number },
  },
  
  // ========== ARTIFACT ==========
  artifact: {
    type: {
      type: String,
      enum: ['file', 's3', 'mongo'],
      default: 'file',
    },
    path: { type: String, required: true },
    sizeBytes: { type: Number },
    hash: { type: String }, // SHA256 of artifact
  },
  
  // ========== EVALUATION LINK ==========
  evaluationReportId: {
    type: String,
    index: true,
  },
  
  // ========== LIFECYCLE ==========
  trainedAt: {
    type: Date,
    default: Date.now,
    required: true,
    index: true,
  },
  
  trainedBy: {
    type: String,
    enum: ['scheduler', 'manual'],
    default: 'scheduler',
  },
  
  approvedAt: {
    type: Date,
  },
  
  activatedAt: {
    type: Date,
  },
  
  deactivatedAt: {
    type: Date,
  },
  
  // ========== PROMOTION HISTORY ==========
  promotionHistory: [{
    action: { type: String }, // 'PROMOTED', 'DEMOTED', 'ROLLED_BACK'
    from: { type: String },
    to: { type: String },
    reason: { type: String },
    timestamp: { type: Date },
  }],
  
  // ========== NOTES ==========
  notes: {
    type: String,
  },
}, {
  collection: 'ml_model_versions',
  timestamps: true, // createdAt, updatedAt
});

// Indexes
MLModelVersionSchema.index({ horizon: 1, status: 1, trainedAt: -1 });
MLModelVersionSchema.index({ datasetVersionId: 1 });
MLModelVersionSchema.index({ status: 1, trainedAt: -1 });

export const MLModelVersionModel = mongoose.model(
  'MLModelVersion',
  MLModelVersionSchema
);

/**
 * Generate model ID
 */
export function generateModelId(horizon: '7d' | '30d'): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const time = new Date().toISOString().split('T')[1].slice(0, 8).replace(/:/g, ''); // HHMMSS
  const hash = crypto.randomBytes(4).toString('hex');
  return `ml_${horizon}_${date}_${time}_${hash}`;
}

/**
 * Get active model for horizon
 */
export async function getActiveModel(horizon: '7d' | '30d') {
  return MLModelVersionModel
    .findOne({ horizon, status: 'ACTIVE' })
    .lean();
}

/**
 * Get latest candidate for horizon
 */
export async function getLatestCandidate(horizon: '7d' | '30d') {
  return MLModelVersionModel
    .findOne({ horizon, status: 'CANDIDATE' })
    .sort({ trainedAt: -1 })
    .lean();
}

/**
 * Get all models for horizon
 */
export async function getAllModels(horizon?: '7d' | '30d', status?: ModelStatus) {
  const query: any = {};
  
  if (horizon) query.horizon = horizon;
  if (status) query.status = status;
  
  return MLModelVersionModel
    .find(query)
    .sort({ trainedAt: -1 })
    .lean();
}

/**
 * Update model status
 */
export async function updateModelStatus(
  modelId: string,
  status: ModelStatus,
  reason?: string
) {
  const update: any = {
    status,
  };
  
  if (status === 'APPROVED') {
    update.approvedAt = new Date();
  } else if (status === 'ACTIVE') {
    update.activatedAt = new Date();
  } else if (status === 'INACTIVE' || status === 'ROLLED_BACK') {
    update.deactivatedAt = new Date();
  }
  
  if (reason) {
    update.$push = {
      promotionHistory: {
        action: status,
        timestamp: new Date(),
        reason,
      },
    };
  }
  
  return MLModelVersionModel.findOneAndUpdate(
    { modelId },
    update,
    { new: true }
  );
}
