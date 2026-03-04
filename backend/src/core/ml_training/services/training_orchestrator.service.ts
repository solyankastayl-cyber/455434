/**
 * ML Training Orchestrator (P0.8)
 * 
 * Orchestrates ML training runs.
 * Manages lifecycle: create run → check gates → train → validate → store model.
 * 
 * NOTE: Actual ML training is delegated to Python ML service.
 * This service handles workflow, logging, and artifact management.
 */

import {
  createTrainingRun,
  updateTrainingRun,
  getTrainingRun,
  TrainingRunStatus,
  TrainingTrigger,
  ITrainingRunConfig
} from '../storage/ml_training_run.model.js';
import {
  createModel,
  updateModelStatus,
  activateModel,
  ModelType
} from '../storage/ml_model.model.js';
import {
  buildTrainingDataset,
  TrainingDataset,
  DatasetConfig
} from './dataset_builder.service.js';
import { FEATURE_TAXONOMY_VERSION } from '../../ml_features_v2/types/feature.types.js';

// ============================================
// Types
// ============================================

export interface TrainingRequest {
  modelType: ModelType;
  targetVersion: string;
  trigger: TrainingTrigger;
  triggeredBy?: string;
  
  datasetConfig?: DatasetConfig;
  trainingConfig?: ITrainingRunConfig;
  
  notes?: string;
}

export interface TrainingResult {
  runId: string;
  status: TrainingRunStatus;
  modelId?: string;
  metrics?: Record<string, number>;
  durationMs?: number;
  error?: string;
}

// ============================================
// Training Orchestrator
// ============================================

/**
 * Start a new training run
 */
export async function startTraining(request: TrainingRequest): Promise<TrainingResult> {
  const startTime = Date.now();
  let runId: string | undefined;
  
  try {
    // 1. Build dataset (with gate enforcement)
    const dataset = await buildTrainingDataset(request.datasetConfig);
    
    // 2. Create training run record
    const run = await createTrainingRun({
      modelType: request.modelType,
      targetVersion: request.targetVersion,
      status: 'RUNNING',
      trigger: request.trigger,
      startedAt: new Date(),
      datasetVersion: dataset.version,
      trainSamples: dataset.trainSamples,
      valSamples: dataset.valSamples,
      featureCount: dataset.featureCount,
      taxonomyVersion: FEATURE_TAXONOMY_VERSION,
      gatesCheckPassed: true, // Dataset builder already enforced
      gatesCheckResult: {
        coverage: dataset.avgCoverage,
        qualityScore: dataset.avgCoverage, // Simplified
      },
      config: request.trainingConfig,
      triggeredBy: request.triggeredBy,
      notes: request.notes
    });
    
    runId = run.runId;
    
    // 3. Execute training (simulated for now - actual training in Python)
    // In production, this would call the Python ML service
    const trainingResult = await executeTraining(dataset, request.trainingConfig);
    
    // 4. Create model record
    const model = await createModel({
      version: request.targetVersion,
      type: request.modelType,
      status: 'VALIDATING',
      trainedAt: new Date(),
      trainingRunId: runId,
      trainingDurationMs: Date.now() - startTime,
      datasetVersion: dataset.version,
      sampleCount: dataset.sampleCount,
      featureCount: dataset.featureCount,
      taxonomyVersion: FEATURE_TAXONOMY_VERSION,
      metrics: trainingResult.metrics
    });
    
    // 5. Update training run
    const durationMs = Date.now() - startTime;
    await updateTrainingRun(runId, {
      status: 'COMPLETED',
      completedAt: new Date(),
      durationMs,
      outputModelId: model.modelId,
      metrics: {
        loss: trainingResult.metrics?.loss,
        valLoss: trainingResult.metrics?.valLoss,
        epochs: trainingResult.epochsRun,
        trainingTime: durationMs
      }
    });
    
    return {
      runId,
      status: 'COMPLETED',
      modelId: model.modelId,
      metrics: trainingResult.metrics,
      durationMs
    };
    
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Update run with failure
    if (runId) {
      await updateTrainingRun(runId, {
        status: 'FAILED',
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
        errorMessage,
        errorStack: (error as Error).stack
      });
    }
    
    return {
      runId: runId || 'unknown',
      status: 'FAILED',
      error: errorMessage,
      durationMs: Date.now() - startTime
    };
  }
}

/**
 * Execute actual training
 * NOTE: This is a simulation. Real implementation would call Python ML service.
 */
async function executeTraining(
  dataset: TrainingDataset,
  config?: ITrainingRunConfig
): Promise<{
  metrics: Record<string, number>;
  epochsRun: number;
}> {
  // Simulate training delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Generate simulated metrics based on dataset quality
  const baseAccuracy = 0.6 + (dataset.avgCoverage / 100) * 0.3; // 60-90% based on coverage
  const noise = (Math.random() - 0.5) * 0.1;
  
  return {
    metrics: {
      accuracy: Math.round((baseAccuracy + noise) * 100) / 100,
      loss: Math.round((1 - baseAccuracy + Math.random() * 0.2) * 1000) / 1000,
      valLoss: Math.round((1 - baseAccuracy + Math.random() * 0.3) * 1000) / 1000,
      precision: Math.round((baseAccuracy - 0.05 + Math.random() * 0.1) * 100) / 100,
      recall: Math.round((baseAccuracy - 0.03 + Math.random() * 0.08) * 100) / 100
    },
    epochsRun: config?.epochs || 10
  };
}

/**
 * Validate and activate a model
 */
export async function validateAndActivateModel(
  modelId: string,
  validationMetrics?: Record<string, number>
): Promise<boolean> {
  // Update with validation metrics
  if (validationMetrics) {
    await updateModelStatus(modelId, 'VALIDATING', {
      validationMetrics
    });
  }
  
  // Simple validation: check if metrics meet threshold
  // In production, this would be more sophisticated
  const meetsThreshold = !validationMetrics || 
    (validationMetrics.accuracy || 0) >= 0.5;
  
  if (meetsThreshold) {
    await activateModel(modelId);
    return true;
  }
  
  await updateModelStatus(modelId, 'FAILED');
  return false;
}

/**
 * Get training run status
 */
export async function getTrainingStatus(runId: string): Promise<{
  status: TrainingRunStatus;
  progress?: number;
  metrics?: Record<string, number>;
} | null> {
  const run = await getTrainingRun(runId);
  
  if (!run) return null;
  
  return {
    status: run.status,
    progress: run.status === 'COMPLETED' ? 100 : run.status === 'RUNNING' ? 50 : 0,
    metrics: run.metrics ? {
      loss: run.metrics.loss,
      valLoss: run.metrics.valLoss
    } : undefined
  };
}
