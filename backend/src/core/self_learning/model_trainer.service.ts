/**
 * Model Trainer Service (ETAP 5.3)
 * 
 * Orchestrates model training on frozen datasets.
 * 
 * CRITICAL PRINCIPLES:
 * - Trainer ONLY trains, doesn't decide
 * - One trainer = one model = one datasetVersion
 * - NO gate logic, NO comparisons
 * - Creates CANDIDATE model (never ACTIVE)
 */
import axios from 'axios';
import {
  MLModelVersionModel,
  generateModelId,
  type ModelStatus,
} from './ml_model_version.model.js';
import { loadTrainingDataset, validateTrainingDataset } from './training_dataset.service.js';
import { getClassWeights } from './label_builder.service.js';
import { logSelfLearningEvent } from './audit_helpers.js';
import { env } from '../../config/env.js';

export interface TrainModelRequest {
  datasetVersionId: string;
  horizon: '7d' | '30d';
  algorithm?: 'logreg' | 'lightgbm';
  hyperparameters?: any;
  triggeredBy?: 'scheduler' | 'manual';
}

export interface TrainModelResult {
  success: boolean;
  modelId?: string;
  modelVersion?: any;
  trainMetrics?: any;
  error?: string;
  duration: number;
}

/**
 * Train candidate model on frozen dataset
 * 
 * @param request - Training request
 * @returns TrainModelResult
 */
export async function trainModel(request: TrainModelRequest): Promise<TrainModelResult> {
  const start = Date.now();
  const { datasetVersionId, horizon, algorithm = 'lightgbm', triggeredBy = 'scheduler' } = request;
  
  console.log(`[Model Trainer] ========== TRAINING START ==========`);
  console.log(`[Model Trainer] Dataset: ${datasetVersionId}`);
  console.log(`[Model Trainer] Horizon: ${horizon}`);
  console.log(`[Model Trainer] Algorithm: ${algorithm}`);
  
  // Generate model ID
  const modelId = generateModelId(horizon);
  
  try {
    // ========== STEP 1: LOAD DATASET ==========
    console.log(`[Model Trainer] Step 1: Loading dataset...`);
    
    const dataset = await loadTrainingDataset(datasetVersionId);
    
    // Validate dataset
    const validation = validateTrainingDataset(dataset);
    if (!validation.valid) {
      throw new Error(`Dataset validation failed: ${validation.issues.join(', ')}`);
    }
    
    console.log(`[Model Trainer] Dataset loaded:`);
    console.log(`  Train samples: ${dataset.train.sampleCount}`);
    console.log(`  Eval samples: ${dataset.eval.sampleCount}`);
    console.log(`  Features: ${dataset.metadata.featureCount}`);
    console.log(`  Train +/-: ${dataset.metadata.labelCounts.train.positive}/${dataset.metadata.labelCounts.train.negative}`);
    
    // ========== STEP 2: PREPARE TRAINING PAYLOAD ==========
    console.log(`[Model Trainer] Step 2: Preparing training payload...`);
    
    // Calculate class weights for imbalance
    const classWeights = getClassWeights(dataset.metadata.labelCounts.train);
    
    const trainingPayload = {
      // Features and labels
      X_train: dataset.train.X,
      y_train: dataset.train.y,
      sample_weights_train: dataset.train.weights,
      
      X_eval: dataset.eval.X,
      y_eval: dataset.eval.y,
      
      // Metadata
      feature_names: dataset.metadata.featureNames,
      horizon,
      
      // Hyperparameters
      algorithm,
      class_weight: classWeights,
      hyperparameters: request.hyperparameters || getDefaultHyperparameters(algorithm),
      
      // Identifiers
      model_id: modelId,
      dataset_version_id: datasetVersionId,
    };
    
    // ========== LOG TRAINING START ==========
    await logSelfLearningEvent({
      eventType: 'TRAIN_STARTED',
      horizon,
      datasetVersionId,
      modelVersionId: modelId,
      details: {
        algorithm,
        trainSamples: dataset.train.sampleCount,
        evalSamples: dataset.eval.sampleCount,
        featureCount: dataset.metadata.featureCount,
      },
      triggeredBy,
      severity: 'info',
    });
    
    // ========== STEP 3: CALL PYTHON ML SERVICE ==========
    console.log(`[Model Trainer] Step 3: Calling Python ML service...`);
    
    const mlServiceUrl = env.ML_SERVICE_URL || 'http://localhost:8003';
    const trainEndpoint = `${mlServiceUrl}/train-etap5`;
    
    let trainResponse;
    try {
      const response = await axios.post(trainEndpoint, trainingPayload, {
        timeout: 300000, // 5 min timeout
        headers: { 'Content-Type': 'application/json' },
      });
      
      trainResponse = response.data;
      console.log(`[Model Trainer] Training completed`);
      
    } catch (apiError: any) {
      console.error(`[Model Trainer] ML service error:`, apiError.message);
      
      await logSelfLearningEvent({
        eventType: 'TRAIN_FAILED',
        horizon,
        datasetVersionId,
        modelVersionId: modelId,
        details: {
          error: apiError.message,
          endpoint: trainEndpoint,
        },
        triggeredBy,
        severity: 'error',
      });
      
      throw new Error(`ML service training failed: ${apiError.message}`);
    }
    
    // ========== STEP 4: SAVE MODEL VERSION ==========
    console.log(`[Model Trainer] Step 4: Saving model version...`);
    
    const modelVersion = await MLModelVersionModel.create({
      modelId,
      status: 'CANDIDATE', // Always CANDIDATE
      horizon,
      datasetVersionId,
      
      // Schema
      featuresSchemaHash: dataset.metadata.schemaHash,
      featureCount: dataset.metadata.featureCount,
      featureNames: dataset.metadata.featureNames,
      
      // Training meta
      trainingMeta: {
        trainSamples: dataset.train.sampleCount,
        evalSamples: dataset.eval.sampleCount,
        liveShare: 0, // TODO: from dataset
        driftLevel: 'MEDIUM', // TODO: from dataset
        timeRange: {
          from: dataset.metadata.trainTimeRange.from,
          to: dataset.metadata.evalTimeRange.to,
        },
        splitMethod: dataset.metadata.splitMethod,
        splitRatio: dataset.metadata.splitRatio,
      },
      
      // Hyperparameters
      hyperparameters: {
        algorithm,
        classWeight: classWeights,
        ...request.hyperparameters,
      },
      
      // Training metrics
      trainMetrics: trainResponse.metrics || {},
      
      // Artifact
      artifact: {
        type: 'file',
        path: trainResponse.artifact_path || `/models/${modelId}.pkl`,
        sizeBytes: trainResponse.artifact_size || 0,
        hash: trainResponse.artifact_hash || '',
      },
      
      // Lifecycle
      trainedAt: new Date(),
      trainedBy: triggeredBy,
    });
    
    console.log(`[Model Trainer] Model version saved: ${modelId}`);
    
    // ========== LOG SUCCESS ==========
    await logSelfLearningEvent({
      eventType: 'TRAIN_FINISHED',
      horizon,
      datasetVersionId,
      modelVersionId: modelId,
      details: {
        trainMetrics: trainResponse.metrics,
        duration: Date.now() - start,
      },
      triggeredBy,
      severity: 'info',
    });
    
    const duration = Date.now() - start;
    console.log(`[Model Trainer] ========== COMPLETE (${duration}ms) ==========`);
    
    return {
      success: true,
      modelId,
      modelVersion,
      trainMetrics: trainResponse.metrics,
      duration,
    };
    
  } catch (error: any) {
    console.error(`[Model Trainer] Training failed:`, error);
    
    const duration = Date.now() - start;
    
    await logSelfLearningEvent({
      eventType: 'TRAIN_FAILED',
      horizon,
      datasetVersionId,
      modelVersionId: modelId,
      details: {
        error: error.message,
        duration,
      },
      triggeredBy,
      severity: 'error',
    });
    
    return {
      success: false,
      error: error.message,
      duration,
    };
  }
}

/**
 * Get default hyperparameters
 */
function getDefaultHyperparameters(algorithm: 'logreg' | 'lightgbm'): any {
  if (algorithm === 'logreg') {
    return {
      C: 1.0,
      max_iter: 1000,
      solver: 'lbfgs',
    };
  } else if (algorithm === 'lightgbm') {
    return {
      n_estimators: 100,
      max_depth: 5,
      learning_rate: 0.05,
      num_leaves: 31,
      min_child_samples: 20,
      subsample: 0.8,
      colsample_bytree: 0.8,
      reg_alpha: 0.1,
      reg_lambda: 0.1,
    };
  }
  
  return {};
}

/**
 * Get model by ID
 */
export async function getModelById(modelId: string) {
  return MLModelVersionModel.findOne({ modelId }).lean();
}

/**
 * Get models list
 */
export async function getModels(filters?: {
  horizon?: '7d' | '30d';
  status?: ModelStatus;
  limit?: number;
}) {
  const query: any = {};
  
  if (filters?.horizon) query.horizon = filters.horizon;
  if (filters?.status) query.status = filters.status;
  
  return MLModelVersionModel
    .find(query)
    .sort({ trainedAt: -1 })
    .limit(filters?.limit || 50)
    .lean();
}

/**
 * Get training history
 */
export async function getTrainingHistory(horizon?: '7d' | '30d', limit: number = 20) {
  const query: any = {};
  if (horizon) query.horizon = horizon;
  
  return MLModelVersionModel
    .find(query)
    .sort({ trainedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get latest trained model
 */
export async function getLatestTrainedModel(horizon: '7d' | '30d') {
  return MLModelVersionModel
    .findOne({ horizon, status: { $in: ['CANDIDATE', 'APPROVED', 'ACTIVE'] } })
    .sort({ trainedAt: -1 })
    .lean();
}
