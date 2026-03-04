/**
 * Model Registry Service
 * 
 * ETAP 5.3: Single source of truth for all model versions.
 * 
 * Responsibilities:
 * - Register new models
 * - Track active model per horizon
 * - Manage promotions and rejections
 */
import { ModelVersionModel, type IModelVersion } from './model_version.model.js';
import type { Horizon } from './self_learning.types.js';

// ==================== INTERFACE ====================

export interface ModelRegistry {
  register(version: Partial<IModelVersion>): Promise<IModelVersion>;
  getById(id: string): Promise<IModelVersion | null>;
  getActive(horizon: Horizon): Promise<IModelVersion | null>;
  listByDataset(datasetVersionId: string): Promise<IModelVersion[]>;
  listByHorizon(horizon: Horizon, limit?: number): Promise<IModelVersion[]>;
  promote(id: string): Promise<IModelVersion>;
  reject(id: string, reason: string): Promise<IModelVersion>;
  rollback(horizon: Horizon): Promise<IModelVersion | null>;
}

// ==================== IMPLEMENTATION ====================

/**
 * Register a new model version
 */
export async function registerModel(version: Partial<IModelVersion>): Promise<IModelVersion> {
  const model = await ModelVersionModel.create(version);
  console.log(`[ModelRegistry] Registered model: ${model.modelVersion}`);
  return model;
}

/**
 * Get model by ID
 */
export async function getModelById(id: string): Promise<IModelVersion | null> {
  return ModelVersionModel.findOne({ modelVersion: id }).lean();
}

/**
 * Get currently active (promoted) model for horizon
 */
export async function getActiveModel(horizon: Horizon): Promise<IModelVersion | null> {
  return ModelVersionModel.findOne({
    horizon,
    status: 'PROMOTED',
  }).sort({ promotedAt: -1 }).lean();
}

/**
 * List models by dataset version
 */
export async function listModelsByDataset(datasetVersionId: string): Promise<IModelVersion[]> {
  return ModelVersionModel.find({ datasetVersion: datasetVersionId })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * List models by horizon
 */
export async function listModelsByHorizon(horizon: Horizon, limit: number = 20): Promise<IModelVersion[]> {
  return ModelVersionModel.find({ horizon })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Promote model to active
 * 
 * - Demotes current active model
 * - Promotes new model
 * - Does NOT delete old model
 */
export async function promoteModel(id: string): Promise<IModelVersion> {
  const model = await ModelVersionModel.findOne({ modelVersion: id });
  
  if (!model) {
    throw new Error(`Model not found: ${id}`);
  }
  
  if (model.status === 'REJECTED') {
    throw new Error(`Cannot promote rejected model: ${id}`);
  }
  
  if (model.status === 'PROMOTED') {
    return model;
  }
  
  // Demote current active model (if any)
  await ModelVersionModel.updateMany(
    { horizon: model.horizon, status: 'PROMOTED' },
    { status: 'ROLLED_BACK' }
  );
  
  // Promote new model
  model.status = 'PROMOTED';
  model.promotedAt = new Date();
  await model.save();
  
  console.log(`[ModelRegistry] Promoted model: ${id}`);
  
  return model;
}

/**
 * Reject model (final - cannot be undone)
 */
export async function rejectModel(id: string, reason: string): Promise<IModelVersion> {
  const model = await ModelVersionModel.findOne({ modelVersion: id });
  
  if (!model) {
    throw new Error(`Model not found: ${id}`);
  }
  
  if (model.status === 'PROMOTED') {
    throw new Error(`Cannot reject promoted model: ${id}. Use rollback instead.`);
  }
  
  model.status = 'REJECTED';
  model.rejectedAt = new Date();
  model.rejectionReason = reason;
  await model.save();
  
  console.log(`[ModelRegistry] Rejected model: ${id} - ${reason}`);
  
  return model;
}

/**
 * Rollback to previous model
 * 
 * - Demotes current active model
 * - Re-promotes previous model
 */
export async function rollbackModel(horizon: Horizon): Promise<IModelVersion | null> {
  // Find current active model
  const currentActive = await ModelVersionModel.findOne({
    horizon,
    status: 'PROMOTED',
  });
  
  if (!currentActive) {
    console.log(`[ModelRegistry] No active model to rollback for ${horizon}`);
    return null;
  }
  
  // Find previous model (most recent ROLLED_BACK)
  const previousModel = await ModelVersionModel.findOne({
    horizon,
    status: 'ROLLED_BACK',
  }).sort({ promotedAt: -1 });
  
  if (!previousModel) {
    console.log(`[ModelRegistry] No previous model to rollback to for ${horizon}`);
    return null;
  }
  
  // Demote current
  currentActive.status = 'ROLLED_BACK';
  await currentActive.save();
  
  // Re-promote previous
  previousModel.status = 'PROMOTED';
  previousModel.promotedAt = new Date();
  await previousModel.save();
  
  console.log(`[ModelRegistry] Rolled back from ${currentActive.modelVersion} to ${previousModel.modelVersion}`);
  
  return previousModel;
}

/**
 * Get model statistics
 */
export async function getModelStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byHorizon: Record<string, number>;
  activeModels: Record<string, string | null>;
}> {
  const [total, byStatus, byHorizon] = await Promise.all([
    ModelVersionModel.countDocuments(),
    ModelVersionModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ModelVersionModel.aggregate([
      { $group: { _id: '$horizon', count: { $sum: 1 } } },
    ]),
  ]);
  
  const statusCounts: Record<string, number> = {};
  byStatus.forEach(s => { statusCounts[s._id] = s.count; });
  
  const horizonCounts: Record<string, number> = {};
  byHorizon.forEach(h => { horizonCounts[h._id] = h.count; });
  
  // Get active models
  const active7d = await getActiveModel('7d');
  const active30d = await getActiveModel('30d');
  
  return {
    total,
    byStatus: statusCounts,
    byHorizon: horizonCounts,
    activeModels: {
      '7d': active7d?.modelVersion || null,
      '30d': active30d?.modelVersion || null,
    },
  };
}

/**
 * Compare two models
 */
export async function compareModels(
  modelId1: string,
  modelId2: string
): Promise<{
  model1: IModelVersion | null;
  model2: IModelVersion | null;
  metricsDiff: Record<string, number>;
}> {
  const [model1, model2] = await Promise.all([
    getModelById(modelId1),
    getModelById(modelId2),
  ]);
  
  const metricsDiff: Record<string, number> = {};
  
  if (model1?.trainingMetrics && model2?.trainingMetrics) {
    const m1 = model1.trainingMetrics as Record<string, number>;
    const m2 = model2.trainingMetrics as Record<string, number>;
    
    Object.keys(m1).forEach(key => {
      metricsDiff[key] = (m2[key] || 0) - (m1[key] || 0);
    });
  }
  
  return { model1, model2, metricsDiff };
}
