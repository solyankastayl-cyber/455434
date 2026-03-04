/**
 * Phase W: Model Registry
 * 
 * Manages ML models and rollout gates.
 */

import { getDb } from '../../../db/mongodb.js';
import { logger } from '../infra/logger.js';

const COLLECTION_NAME = 'ta_ml_models';

export type ModelStatus = 'SHADOW' | 'LIVE_LITE' | 'LIVE_MED' | 'LIVE_FULL' | 'DISABLED';

export interface ModelMetrics {
  auc: number;
  logloss: number;
  brier: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ModelGates {
  minRows: number;
  minAuc: number;
  maxBrier: number;
  maxDeltaProb: number;
}

export interface MLModel {
  modelId: string;
  name: string;
  version: string;
  
  // Scope
  timeframes: string[];
  regimeScope: string[];
  
  // Training info
  trainedAt: number;
  trainRows: number;
  testRows: number;
  
  // Metrics
  metrics: ModelMetrics;
  
  // Gates
  gates: ModelGates;
  
  // Status
  status: ModelStatus;
  activatedAt?: number;
  
  // Artifacts
  artifactPath?: string;
  featureList: string[];
  
  // Alpha for blending
  mlAlpha: number;
}

const DEFAULT_GATES: ModelGates = {
  minRows: 5000,
  minAuc: 0.55,
  maxBrier: 0.25,
  maxDeltaProb: 0.12,
};

const STATUS_ALPHA: Record<ModelStatus, number> = {
  SHADOW: 0.0,
  LIVE_LITE: 0.25,
  LIVE_MED: 0.50,
  LIVE_FULL: 0.80,
  DISABLED: 0.0,
};

/**
 * Initialize model registry indexes
 */
export async function initModelIndexes(): Promise<void> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  await collection.createIndex({ modelId: 1 }, { unique: true });
  await collection.createIndex({ status: 1 });
  await collection.createIndex({ trainedAt: -1 });
  
  logger.info({ phase: 'ml', collection: COLLECTION_NAME }, 'Model indexes created');
}

/**
 * Register a new model
 */
export async function registerModel(model: Omit<MLModel, 'mlAlpha'>): Promise<MLModel> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const fullModel: MLModel = {
    ...model,
    mlAlpha: STATUS_ALPHA[model.status],
  };
  
  await collection.insertOne({
    ...fullModel,
    createdAt: Date.now(),
  });
  
  logger.info({ 
    phase: 'ml', 
    modelId: model.modelId,
    status: model.status,
    auc: model.metrics.auc
  }, 'Model registered');
  
  return fullModel;
}

/**
 * Check if model passes gates for activation
 */
export function checkGates(model: MLModel): { passed: boolean; reasons: string[] } {
  const gates = model.gates || DEFAULT_GATES;
  const reasons: string[] = [];
  
  if (model.trainRows < gates.minRows) {
    reasons.push(`trainRows ${model.trainRows} < minRows ${gates.minRows}`);
  }
  
  if (model.metrics.auc < gates.minAuc) {
    reasons.push(`auc ${model.metrics.auc.toFixed(3)} < minAuc ${gates.minAuc}`);
  }
  
  if (model.metrics.brier > gates.maxBrier) {
    reasons.push(`brier ${model.metrics.brier.toFixed(3)} > maxBrier ${gates.maxBrier}`);
  }
  
  return {
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * Activate model to a new status
 */
export async function activateModel(
  modelId: string,
  newStatus: ModelStatus
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const model = await collection.findOne({ modelId }) as MLModel | null;
  
  if (!model) {
    return { success: false, error: 'Model not found' };
  }
  
  // Check gates for non-SHADOW activation
  if (newStatus !== 'SHADOW' && newStatus !== 'DISABLED') {
    const gateCheck = checkGates(model);
    
    if (!gateCheck.passed) {
      return { 
        success: false, 
        error: `Gates not passed: ${gateCheck.reasons.join(', ')}` 
      };
    }
  }
  
  const newAlpha = STATUS_ALPHA[newStatus];
  
  await collection.updateOne(
    { modelId },
    {
      $set: {
        status: newStatus,
        mlAlpha: newAlpha,
        activatedAt: newStatus !== 'DISABLED' ? Date.now() : undefined,
        updatedAt: Date.now(),
      },
    }
  );
  
  logger.info({ 
    phase: 'ml', 
    modelId,
    oldStatus: model.status,
    newStatus,
    mlAlpha: newAlpha
  }, 'Model status changed');
  
  return { success: true };
}

/**
 * Get active model for inference
 */
export async function getActiveModel(
  timeframe?: string,
  regime?: string
): Promise<MLModel | null> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const filter: any = {
    status: { $in: ['LIVE_LITE', 'LIVE_MED', 'LIVE_FULL'] },
  };
  
  if (timeframe) {
    filter.timeframes = timeframe;
  }
  
  // Get most recent active model
  const model = await collection
    .find(filter)
    .sort({ trainedAt: -1 })
    .limit(1)
    .toArray();
  
  return model[0] as MLModel | null;
}

/**
 * Get all models
 */
export async function getAllModels(): Promise<MLModel[]> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const models = await collection
    .find({}, { projection: { _id: 0 } })
    .sort({ trainedAt: -1 })
    .toArray();
  
  return models as MLModel[];
}

/**
 * Get model by ID
 */
export async function getModel(modelId: string): Promise<MLModel | null> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const model = await collection.findOne(
    { modelId },
    { projection: { _id: 0 } }
  );
  
  return model as MLModel | null;
}

/**
 * Delete model
 */
export async function deleteModel(modelId: string): Promise<boolean> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const result = await collection.deleteOne({ modelId });
  
  return result.deletedCount > 0;
}
