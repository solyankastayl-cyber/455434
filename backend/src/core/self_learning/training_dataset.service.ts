/**
 * Training Dataset Service (ETAP 5.3)
 * 
 * Loads frozen dataset and prepares for training.
 * 
 * CRITICAL:
 * - Time-based split (NOT random!) to prevent data leakage
 * - Train on older data, eval on newer data
 * - Reproducible splits
 */
import { DatasetVersionModel } from './dataset_version.model.js';
import { LearningSampleModel } from '../learning/dataset/learning_sample.model.js';
import { buildFeatureMatrix } from './feature_builder.service.js';
import { buildLabels, type LabelsResult } from './label_builder.service.js';

export interface TrainingDataset {
  train: {
    X: number[][];
    y: number[];
    weights: number[];
    sampleCount: number;
  };
  eval: {
    X: number[][];
    y: number[];
    weights: number[];
    sampleCount: number;
  };
  metadata: {
    datasetVersionId: string;
    horizon: '7d' | '30d';
    featureNames: string[];
    featureCount: number;
    schemaHash: string;
    splitMethod: 'time_based';
    splitRatio: number;
    splitTimestamp: Date;
    trainTimeRange: { from: Date; to: Date };
    evalTimeRange: { from: Date; to: Date };
    labelCounts: {
      train: { positive: number; negative: number };
      eval: { positive: number; negative: number };
    };
  };
}

/**
 * Load and prepare dataset for training
 * 
 * @param datasetVersionId - Frozen dataset version
 * @param splitRatio - Train/eval split (default 0.8 = 80% train, 20% eval)
 * @returns TrainingDataset
 */
export async function loadTrainingDataset(
  datasetVersionId: string,
  splitRatio: number = 0.8
): Promise<TrainingDataset> {
  console.log(`[Dataset Loader] Loading dataset: ${datasetVersionId}`);
  
  // ========== LOAD DATASET VERSION ==========
  
  const datasetVersion = await DatasetVersionModel
    .findOne({ datasetVersion: datasetVersionId })
    .lean();
  
  if (!datasetVersion) {
    throw new Error(`Dataset version not found: ${datasetVersionId}`);
  }
  
  const horizon = datasetVersion.horizon;
  
  console.log(`[Dataset Loader] Dataset horizon: ${horizon}`);
  console.log(`[Dataset Loader] Expected samples: ${datasetVersion.sampleCount}`);
  
  // ========== LOAD SAMPLES ==========
  
  // Use frozen query from dataset version
  const query = datasetVersion.artifact.query;
  
  const samples = await LearningSampleModel
    .find(query)
    .sort({ snapshotAt: 1 }) // CRITICAL: Sort by time for time-based split
    .lean();
  
  console.log(`[Dataset Loader] Loaded ${samples.length} samples`);
  
  if (samples.length === 0) {
    throw new Error('No samples found for dataset');
  }
  
  // ========== TIME-BASED SPLIT ==========
  
  // CRITICAL: Split by time, not random
  // Train on older data, eval on newer data
  const splitIndex = Math.floor(samples.length * splitRatio);
  
  const trainSamples = samples.slice(0, splitIndex);
  const evalSamples = samples.slice(splitIndex);
  
  console.log(`[Dataset Loader] Split: ${trainSamples.length} train, ${evalSamples.length} eval`);
  
  // Get split timestamp (time boundary between train and eval)
  const splitTimestamp = evalSamples[0]?.snapshotAt || new Date();
  
  // ========== BUILD FEATURES ==========
  
  console.log(`[Dataset Loader] Building features...`);
  
  const trainFeatures = buildFeatureMatrix(trainSamples);
  const evalFeatures = buildFeatureMatrix(evalSamples);
  
  // Verify schema consistency
  if (trainFeatures.schemaHash !== evalFeatures.schemaHash) {
    throw new Error(
      `Schema mismatch between train and eval: ` +
      `train=${trainFeatures.schemaHash}, eval=${evalFeatures.schemaHash}`
    );
  }
  
  console.log(`[Dataset Loader] Features: ${trainFeatures.featureNames.length} features`);
  console.log(`[Dataset Loader] Schema hash: ${trainFeatures.schemaHash}`);
  
  // ========== BUILD LABELS ==========
  
  console.log(`[Dataset Loader] Building labels...`);
  
  const trainLabels = buildLabels(trainSamples, horizon);
  const evalLabels = buildLabels(evalSamples, horizon);
  
  console.log(
    `[Dataset Loader] Train labels: ${trainLabels.labelCounts.positive} positive, ` +
    `${trainLabels.labelCounts.negative} negative`
  );
  console.log(
    `[Dataset Loader] Eval labels: ${evalLabels.labelCounts.positive} positive, ` +
    `${evalLabels.labelCounts.negative} negative`
  );
  
  // ========== VERIFY SAMPLE COUNTS ==========
  
  if (trainFeatures.X.length !== trainLabels.y.length) {
    throw new Error(
      `Feature/label count mismatch in train: ` +
      `X=${trainFeatures.X.length}, y=${trainLabels.y.length}`
    );
  }
  
  if (evalFeatures.X.length !== evalLabels.y.length) {
    throw new Error(
      `Feature/label count mismatch in eval: ` +
      `X=${evalFeatures.X.length}, y=${evalLabels.y.length}`
    );
  }
  
  // ========== TIME RANGES ==========
  
  const trainTimeRange = {
    from: trainSamples[0]?.snapshotAt || new Date(),
    to: trainSamples[trainSamples.length - 1]?.snapshotAt || new Date(),
  };
  
  const evalTimeRange = {
    from: evalSamples[0]?.snapshotAt || new Date(),
    to: evalSamples[evalSamples.length - 1]?.snapshotAt || new Date(),
  };
  
  console.log(`[Dataset Loader] Train time range: ${trainTimeRange.from.toISOString()} - ${trainTimeRange.to.toISOString()}`);
  console.log(`[Dataset Loader] Eval time range: ${evalTimeRange.from.toISOString()} - ${evalTimeRange.to.toISOString()}`);
  
  // ========== RETURN DATASET ==========
  
  return {
    train: {
      X: trainFeatures.X,
      y: trainLabels.y,
      weights: trainLabels.weights,
      sampleCount: trainLabels.y.length,
    },
    eval: {
      X: evalFeatures.X,
      y: evalLabels.y,
      weights: evalLabels.weights,
      sampleCount: evalLabels.y.length,
    },
    metadata: {
      datasetVersionId,
      horizon,
      featureNames: trainFeatures.featureNames,
      featureCount: trainFeatures.featureNames.length,
      schemaHash: trainFeatures.schemaHash,
      splitMethod: 'time_based',
      splitRatio,
      splitTimestamp,
      trainTimeRange,
      evalTimeRange,
      labelCounts: {
        train: trainLabels.labelCounts,
        eval: evalLabels.labelCounts,
      },
    },
  };
}

/**
 * Validate dataset for training
 */
export function validateTrainingDataset(dataset: TrainingDataset): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  // Check minimum samples
  if (dataset.train.sampleCount < 100) {
    issues.push(`Too few train samples: ${dataset.train.sampleCount}`);
  }
  
  if (dataset.eval.sampleCount < 30) {
    issues.push(`Too few eval samples: ${dataset.eval.sampleCount}`);
  }
  
  // Check class imbalance
  const trainPositiveRatio = dataset.metadata.labelCounts.train.positive /
    (dataset.metadata.labelCounts.train.positive + dataset.metadata.labelCounts.train.negative);
  
  if (trainPositiveRatio < 0.05 || trainPositiveRatio > 0.95) {
    issues.push(`Extreme class imbalance: ${(trainPositiveRatio * 100).toFixed(1)}% positive`);
  }
  
  // Check feature count
  if (dataset.metadata.featureCount < 10) {
    issues.push(`Too few features: ${dataset.metadata.featureCount}`);
  }
  
  // Check time ordering (eval should be after train)
  if (dataset.metadata.evalTimeRange.from <= dataset.metadata.trainTimeRange.to) {
    issues.push('Time overlap: eval data is not strictly after train data');
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}
