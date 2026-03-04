/**
 * Model Version Model
 * 
 * ETAP 5.3: Stores versioned ML model metadata.
 */
import mongoose, { Schema, Document } from 'mongoose';
import type { ModelVersion, Horizon, ModelHyperparams } from './self_learning.types.js';

// ==================== INTERFACE ====================

export interface IModelVersion extends Document, Omit<ModelVersion, 'modelVersion'> {
  modelVersion: string;
}

// ==================== SCHEMAS ====================

const HyperparamsSchema = new Schema({
  algorithm: { type: String, default: 'lightgbm' },
  numLeaves: { type: Number, default: 31 },
  learningRate: { type: Number, default: 0.05 },
  numIterations: { type: Number, default: 100 },
  featureFraction: { type: Number, default: 0.8 },
  baggingFraction: { type: Number, default: 0.8 },
  scalePositiveWeight: { type: Number, default: 1.0 },
}, { _id: false });

const TrainingMetricsSchema = new Schema({
  precision: { type: Number, default: 0 },
  recall: { type: Number, default: 0 },
  f1: { type: Number, default: 0 },
  prAuc: { type: Number, default: 0 },
  logLoss: { type: Number, default: 0 },
  brierScore: { type: Number, default: 0 },
}, { _id: false });

const ModelVersionSchema = new Schema<IModelVersion>({
  modelVersion: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  horizon: {
    type: String,
    enum: ['7d', '30d'],
    required: true,
  },
  
  // Lineage
  datasetVersion: {
    type: String,
    required: true,
    index: true,
  },
  previousModelVersion: {
    type: String,
    default: null,
  },
  
  // Training config
  trainConfigHash: {
    type: String,
    required: true,
    index: true,
  },
  seed: {
    type: Number,
    required: true,
  },
  hyperparams: {
    type: HyperparamsSchema,
    required: true,
  },
  trainTimestamp: {
    type: Date,
    required: true,
  },
  trainDurationMs: {
    type: Number,
    default: 0,
  },
  
  // Artifact
  artifactPath: {
    type: String,
    required: true,
  },
  artifactSize: {
    type: Number,
    default: 0,
  },
  
  // Metrics
  trainingMetrics: {
    type: TrainingMetricsSchema,
    required: true,
  },
  
  // Evaluation (populated after evaluation)
  evaluationMetrics: {
    type: Schema.Types.Mixed,
    default: null,
  },
  evaluationDecision: {
    type: String,
    enum: ['PROMOTE', 'HOLD', 'REJECT', null],
    default: null,
  },
  evaluationReasons: {
    type: [String],
    default: [],
  },
  evaluatedAt: {
    type: Date,
    default: null,
  },
  
  // Status
  status: {
    type: String,
    enum: ['TRAINED', 'EVALUATING', 'PROMOTED', 'REJECTED', 'ROLLED_BACK'],
    default: 'TRAINED',
  },
  promotedAt: {
    type: Date,
    default: null,
  },
  rejectedAt: {
    type: Date,
    default: null,
  },
  rejectionReason: {
    type: String,
    default: null,
  },
}, {
  collection: 'model_versions',
  timestamps: true,
});

// ==================== INDEXES ====================

ModelVersionSchema.index({ horizon: 1, createdAt: -1 });
ModelVersionSchema.index({ status: 1 });
ModelVersionSchema.index({ horizon: 1, status: 1 });

// ==================== STATICS ====================

ModelVersionSchema.statics.findByHorizon = function(
  horizon: Horizon,
  limit: number = 10
): Promise<IModelVersion[]> {
  return this.find({ horizon })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

ModelVersionSchema.statics.findPromoted = function(
  horizon: Horizon
): Promise<IModelVersion | null> {
  return this.findOne({ horizon, status: 'PROMOTED' })
    .sort({ promotedAt: -1 })
    .lean();
};

ModelVersionSchema.statics.findLatestTrained = function(
  horizon: Horizon
): Promise<IModelVersion | null> {
  return this.findOne({ 
    horizon, 
    status: { $in: ['TRAINED', 'PROMOTED'] },
  }).sort({ createdAt: -1 }).lean();
};

// ==================== MODEL ====================

interface ModelVersionModelType extends mongoose.Model<IModelVersion> {
  findByHorizon(horizon: Horizon, limit?: number): Promise<IModelVersion[]>;
  findPromoted(horizon: Horizon): Promise<IModelVersion | null>;
  findLatestTrained(horizon: Horizon): Promise<IModelVersion | null>;
}

export const ModelVersionModel = mongoose.model<IModelVersion, ModelVersionModelType>(
  'ModelVersion',
  ModelVersionSchema
);
