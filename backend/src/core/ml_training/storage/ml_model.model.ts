/**
 * ML Model Storage (P0.8)
 * 
 * Stores model versions and metadata.
 * ML artifacts only - no core data modifications.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type ModelStatus = 'TRAINING' | 'VALIDATING' | 'ACTIVE' | 'ARCHIVED' | 'FAILED';
export type ModelType = 'CONFIDENCE_MODIFIER' | 'ANOMALY_DETECTOR' | 'CALIBRATION';

export interface IModelMetrics {
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  auc?: number;
  mse?: number;
  mae?: number;
  calibrationError?: number;
  custom?: Record<string, number>;
}

export interface IMLModel {
  modelId: string;
  version: string;
  type: ModelType;
  status: ModelStatus;
  
  // Training info
  trainedAt?: Date;
  trainingRunId?: string;
  trainingDurationMs?: number;
  
  // Dataset info
  datasetVersion?: string;
  sampleCount?: number;
  featureCount?: number;
  taxonomyVersion?: string;
  
  // Performance metrics
  metrics?: IModelMetrics;
  validationMetrics?: IModelMetrics;
  
  // Model artifacts (paths or references)
  artifactPath?: string;
  weightsHash?: string;
  configHash?: string;
  
  // Deployment info
  deployedAt?: Date;
  activeUntil?: Date;
  
  // Metadata
  description?: string;
  tags?: string[];
  createdBy?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

export interface IMLModelDocument extends IMLModel, Document {}

// ============================================
// Schema
// ============================================

const ModelMetricsSchema = new Schema<IModelMetrics>({
  accuracy: { type: Number },
  precision: { type: Number },
  recall: { type: Number },
  f1Score: { type: Number },
  auc: { type: Number },
  mse: { type: Number },
  mae: { type: Number },
  calibrationError: { type: Number },
  custom: { type: Map, of: Number }
}, { _id: false });

const MLModelSchema = new Schema<IMLModelDocument>({
  modelId: { type: String, required: true, unique: true, index: true },
  version: { type: String, required: true },
  type: { 
    type: String, 
    required: true,
    enum: ['CONFIDENCE_MODIFIER', 'ANOMALY_DETECTOR', 'CALIBRATION'],
    index: true
  },
  status: { 
    type: String, 
    required: true,
    enum: ['TRAINING', 'VALIDATING', 'ACTIVE', 'ARCHIVED', 'FAILED'],
    index: true
  },
  
  trainedAt: { type: Date },
  trainingRunId: { type: String, index: true },
  trainingDurationMs: { type: Number },
  
  datasetVersion: { type: String },
  sampleCount: { type: Number },
  featureCount: { type: Number },
  taxonomyVersion: { type: String },
  
  metrics: { type: ModelMetricsSchema },
  validationMetrics: { type: ModelMetricsSchema },
  
  artifactPath: { type: String },
  weightsHash: { type: String },
  configHash: { type: String },
  
  deployedAt: { type: Date },
  activeUntil: { type: Date },
  
  description: { type: String },
  tags: [{ type: String }],
  createdBy: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

MLModelSchema.index({ type: 1, status: 1 });
MLModelSchema.index({ version: 1, type: 1 });

// ============================================
// Model
// ============================================

export const MLModelModel = mongoose.model<IMLModelDocument>('ml_models', MLModelSchema);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate model ID
 */
export function generateModelId(type: ModelType, version: string): string {
  return `${type}:${version}:${Date.now()}`;
}

/**
 * Create new model record
 */
export async function createModel(
  model: Omit<IMLModel, 'modelId' | 'createdAt' | 'updatedAt'>
): Promise<IMLModelDocument> {
  const modelId = generateModelId(model.type, model.version);
  
  return MLModelModel.create({
    ...model,
    modelId,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

/**
 * Get active model by type
 */
export async function getActiveModel(type: ModelType): Promise<IMLModelDocument | null> {
  return MLModelModel.findOne({
    type,
    status: 'ACTIVE'
  })
  .sort({ deployedAt: -1 })
  .lean();
}

/**
 * Get model by ID
 */
export async function getModelById(modelId: string): Promise<IMLModelDocument | null> {
  return MLModelModel.findOne({ modelId }).lean();
}

/**
 * List models
 */
export async function listModels(
  filters: { type?: ModelType; status?: ModelStatus } = {},
  limit: number = 20
): Promise<IMLModelDocument[]> {
  const query: any = {};
  if (filters.type) query.type = filters.type;
  if (filters.status) query.status = filters.status;
  
  return MLModelModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Update model status
 */
export async function updateModelStatus(
  modelId: string,
  status: ModelStatus,
  extras: Partial<IMLModel> = {}
): Promise<IMLModelDocument | null> {
  return MLModelModel.findOneAndUpdate(
    { modelId },
    { 
      $set: { 
        status, 
        ...extras,
        updatedAt: new Date() 
      } 
    },
    { new: true }
  ).lean();
}

/**
 * Set model as active (and archive previous active)
 */
export async function activateModel(modelId: string): Promise<IMLModelDocument | null> {
  const model = await MLModelModel.findOne({ modelId });
  if (!model) return null;
  
  // Archive previous active models of same type
  await MLModelModel.updateMany(
    { type: model.type, status: 'ACTIVE' },
    { $set: { status: 'ARCHIVED', updatedAt: new Date() } }
  );
  
  // Activate this model
  return MLModelModel.findOneAndUpdate(
    { modelId },
    { 
      $set: { 
        status: 'ACTIVE', 
        deployedAt: new Date(),
        updatedAt: new Date() 
      } 
    },
    { new: true }
  ).lean();
}

/**
 * Get model statistics
 */
export async function getModelStats(): Promise<{
  totalModels: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  activeModels: number;
}> {
  const [total, byType, byStatus, active] = await Promise.all([
    MLModelModel.countDocuments(),
    MLModelModel.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]),
    MLModelModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    MLModelModel.countDocuments({ status: 'ACTIVE' })
  ]);
  
  return {
    totalModels: total,
    byType: byType.reduce((acc, t) => { acc[t._id] = t.count; return acc; }, {} as Record<string, number>),
    byStatus: byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {} as Record<string, number>),
    activeModels: active
  };
}
