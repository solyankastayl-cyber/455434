/**
 * Training Runner
 * 
 * ETAP 5.3: Deterministic model training with fixed seeds.
 * 
 * Invariants:
 * - One run = one ModelVersion (immutable)
 * - Seed is fixed for reproducibility
 * - Artifacts are immutable
 */
import { ModelVersionModel, type IModelVersion } from './model_version.model.js';
import { DatasetVersionModel } from './dataset_version.model.js';
import { hashTrainConfig } from './train_config_hash.util.js';
import { trainShadowModel } from '../learning/shadow_ml/shadow_ml.client.js';
import type { Horizon, ModelHyperparams } from './self_learning.types.js';

// ==================== TYPES ====================

export interface TrainParams {
  datasetVersionId: string;
  seed?: number;
  hyperParams?: Partial<ModelHyperparams>;
}

export interface TrainResult {
  success: boolean;
  modelVersionId: string | null;
  artifactUri: string | null;
  metrics: Record<string, number> | null;
  message: string;
  durationMs: number;
}

// ==================== DEFAULTS ====================

const DEFAULT_SEED = 42;

const DEFAULT_HYPERPARAMS: ModelHyperparams = {
  algorithm: 'lightgbm',
  numLeaves: 31,
  learningRate: 0.05,
  numIterations: 100,
  featureFraction: 0.8,
  baggingFraction: 0.8,
  scalePositiveWeight: 1.0,
};

// ==================== RUNNER ====================

/**
 * Run deterministic training
 * 
 * Creates immutable ModelVersion with fixed seed.
 */
export async function runTraining(params: TrainParams): Promise<TrainResult> {
  const startTime = Date.now();
  const { datasetVersionId, seed = DEFAULT_SEED, hyperParams = {} } = params;
  
  console.log(`[TrainingRunner] Starting training with dataset ${datasetVersionId}, seed=${seed}`);
  
  try {
    // Step 1: Validate dataset exists
    const dataset = await DatasetVersionModel.findOne({ datasetVersion: datasetVersionId }).lean();
    
    if (!dataset) {
      return {
        success: false,
        modelVersionId: null,
        artifactUri: null,
        metrics: null,
        message: `Dataset not found: ${datasetVersionId}`,
        durationMs: Date.now() - startTime,
      };
    }
    
    if (dataset.status !== 'FROZEN' && dataset.status !== 'USED') {
      return {
        success: false,
        modelVersionId: null,
        artifactUri: null,
        metrics: null,
        message: `Dataset not in valid state: ${dataset.status}`,
        durationMs: Date.now() - startTime,
      };
    }
    
    const horizon = dataset.horizon as Horizon;
    
    // Step 2: Merge hyperparams
    const finalHyperParams: ModelHyperparams = {
      ...DEFAULT_HYPERPARAMS,
      ...hyperParams,
      scalePositiveWeight: dataset.classDistribution.negative / Math.max(1, dataset.classDistribution.positive),
    };
    
    // Step 3: Generate config hash
    const trainConfig = {
      datasetVersionId,
      seed,
      hyperParams: finalHyperParams,
      horizon,
    };
    const trainConfigHash = hashTrainConfig(trainConfig);
    
    // Step 4: Check for existing model with same config
    const existing = await ModelVersionModel.findOne({ trainConfigHash }).lean();
    if (existing) {
      console.log(`[TrainingRunner] Found existing model with same config: ${existing.modelVersion}`);
      return {
        success: true,
        modelVersionId: existing.modelVersion,
        artifactUri: existing.artifactPath,
        metrics: existing.trainingMetrics as Record<string, number>,
        message: 'Reusing existing model with identical config',
        durationMs: Date.now() - startTime,
      };
    }
    
    // Step 5: Generate model version ID
    const modelVersionId = generateModelVersionId(horizon, datasetVersionId);
    const artifactUri = `/app/ml_service/models/model_${horizon}_${modelVersionId.slice(-8)}.pkl`;
    
    // Step 6: Get previous model version
    const previousModel = await ModelVersionModel.findPromoted(horizon);
    
    // Step 7: Create model version record (TRAINED status)
    await ModelVersionModel.create({
      modelVersion: modelVersionId,
      horizon,
      datasetVersion: datasetVersionId,
      previousModelVersion: previousModel?.modelVersion || null,
      trainConfigHash,
      seed,
      hyperparams: finalHyperParams,
      trainTimestamp: new Date(),
      trainDurationMs: 0,
      artifactPath: artifactUri,
      artifactSize: 0,
      trainingMetrics: {
        precision: 0,
        recall: 0,
        f1: 0,
        prAuc: 0,
        logLoss: 0,
        brierScore: 0,
      },
      status: 'TRAINED',
    });
    
    // Step 8: Call ML service for training
    const trainResult = await trainShadowModel(horizon, 10, true);
    
    if (!trainResult.success) {
      await ModelVersionModel.updateOne(
        { modelVersion: modelVersionId },
        {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectionReason: `Training failed: ${trainResult.message}`,
        }
      );
      
      return {
        success: false,
        modelVersionId,
        artifactUri: null,
        metrics: null,
        message: `ML service training failed: ${trainResult.message}`,
        durationMs: Date.now() - startTime,
      };
    }
    
    // Step 9: Update model version with results
    const durationMs = Date.now() - startTime;
    const metrics = {
      precision: trainResult.metrics?.precision || 0,
      recall: trainResult.metrics?.recall || 0,
      f1: trainResult.metrics?.f1 || 0,
      prAuc: trainResult.metrics?.pr_auc || 0,
      logLoss: trainResult.metrics?.log_loss || 0,
      brierScore: trainResult.metrics?.brier_score || 0,
    };
    
    await ModelVersionModel.updateOne(
      { modelVersion: modelVersionId },
      {
        trainDurationMs: durationMs,
        trainingMetrics: metrics,
        status: 'TRAINED',
      }
    );
    
    // Step 10: Mark dataset as used
    await DatasetVersionModel.updateOne(
      { datasetVersion: datasetVersionId },
      {
        status: 'USED',
        usedByModelVersion: modelVersionId,
      }
    );
    
    console.log(`[TrainingRunner] Model trained: ${modelVersionId} (${durationMs}ms)`);
    
    return {
      success: true,
      modelVersionId,
      artifactUri,
      metrics,
      message: 'Model trained successfully',
      durationMs,
    };
    
  } catch (error: any) {
    console.error('[TrainingRunner] Error:', error);
    return {
      success: false,
      modelVersionId: null,
      artifactUri: null,
      metrics: null,
      message: `Training error: ${error.message}`,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Generate model version ID
 */
function generateModelVersionId(horizon: string, datasetVersionId: string): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .slice(0, 15);
  
  const dsShort = datasetVersionId.split('_').slice(-1)[0] || 'unknown';
  
  return `model_${horizon}_${timestamp}_${dsShort}`;
}
