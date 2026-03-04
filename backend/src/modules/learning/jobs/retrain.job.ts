/**
 * PHASE 5.2 — Retrain Job
 * ========================
 * Creates CANDIDATE model from dataset
 */

import { v4 as uuidv4 } from 'uuid';
import { MlRun } from '../storage/ml_run.model.js';
import { MlModelRegistry } from '../storage/ml_model.model.js';
import { ActiveModelState } from '../runtime/active_model.state.js';
import { MlDatasetRowModel } from '../../ml/storage/ml.storage.js';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════
// DATASET BUILDER (simplified for Phase 5.2)
// ═══════════════════════════════════════════════════════════════

interface DatasetRow {
  features: Record<string, number>;
  y: number;
}

interface TrainSet {
  train: DatasetRow[];
  val: DatasetRow[];
  test: DatasetRow[];
  totalRows: number;
  featureNames: string[];
  featureSchemaHash: string;
}

async function buildTrainSet(params: {
  fromTs: number;
  toTs: number;
  split: { train: number; val: number; test: number };
}): Promise<TrainSet> {
  // First check count
  console.log(`[RetrainJob] Building dataset from ${params.fromTs} to ${params.toTs}`);
  
  const count = await MlDatasetRowModel.countDocuments({
    t0: { $gte: params.fromTs, $lte: params.toTs },
  });

  console.log(`[RetrainJob] Found ${count} rows in time range`);

  if (count === 0) {
    throw new Error(`No ML dataset rows found in time range ${params.fromTs} - ${params.toTs}. Please accumulate ML training data first using the data accumulation jobs.`);
  }

  if (count < 100) {
    throw new Error(`Insufficient ML dataset rows (${count}). Minimum 100 rows required for training.`);
  }

  const rows = await MlDatasetRowModel.find({
    t0: { $gte: params.fromTs, $lte: params.toTs },
  }).sort({ t0: 1 }).lean();

  // Extract feature names from first row
  const firstRow = rows[0] as any;
  const featureNames = Object.keys(firstRow.features || {});
  
  if (featureNames.length === 0) {
    throw new Error('Dataset rows have no features');
  }
  
  const featureSchemaHash = crypto.createHash('md5').update(featureNames.join(',')).digest('hex').slice(0, 8);

  // Convert to DatasetRow format
  const dataRows: DatasetRow[] = rows.map((r: any) => ({
    features: r.features || {},
    y: r.y,
  }));

  // Split dataset
  const trainEnd = Math.floor(dataRows.length * params.split.train);
  const valEnd = trainEnd + Math.floor(dataRows.length * params.split.val);

  return {
    train: dataRows.slice(0, trainEnd),
    val: dataRows.slice(trainEnd, valEnd),
    test: dataRows.slice(valEnd),
    totalRows: dataRows.length,
    featureNames,
    featureSchemaHash,
  };
}

// ═══════════════════════════════════════════════════════════════
// LOGISTIC REGRESSION TRAINER (simplified)
// ═══════════════════════════════════════════════════════════════

interface TrainedModel {
  weights: number[];
  bias: number;
  scaler: { mean: number[]; std: number[] };
}

function trainLogReg(trainData: DatasetRow[], featureNames: string[]): TrainedModel {
  const numFeatures = featureNames.length;
  
  // Calculate mean and std for each feature
  const mean = new Array(numFeatures).fill(0);
  const std = new Array(numFeatures).fill(0);
  
  for (const row of trainData) {
    featureNames.forEach((name, i) => {
      const val = row.features[name];
      mean[i] += (typeof val === 'number' && isFinite(val)) ? val : 0;
    });
  }
  mean.forEach((_, i) => mean[i] /= trainData.length);
  
  for (const row of trainData) {
    featureNames.forEach((name, i) => {
      const val = row.features[name];
      const v = (typeof val === 'number' && isFinite(val)) ? val : 0;
      std[i] += Math.pow(v - mean[i], 2);
    });
  }
  std.forEach((_, i) => {
    const s = Math.sqrt(std[i] / trainData.length);
    std[i] = (s > 0.0001) ? s : 1; // Prevent division by zero
  });

  // Ensure mean/std are valid numbers
  mean.forEach((v, i) => { if (!isFinite(v)) mean[i] = 0; });
  std.forEach((v, i) => { if (!isFinite(v) || v === 0) std[i] = 1; });

  // Simple gradient descent training
  const weights = new Array(numFeatures).fill(0);
  let bias = 0;
  const lr = 0.01;
  const epochs = 100;

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const row of trainData) {
      // Normalize features with safety
      const x = featureNames.map((name, i) => {
        const val = row.features[name];
        const v = (typeof val === 'number' && isFinite(val)) ? val : 0;
        const normalized = (v - mean[i]) / std[i];
        return isFinite(normalized) ? normalized : 0;
      });
      
      // Forward pass with clamping to prevent overflow
      const z = Math.max(-500, Math.min(500, 
        x.reduce((sum, xi, i) => sum + xi * weights[i], 0) + bias
      ));
      const pred = 1 / (1 + Math.exp(-z));
      
      // Backward pass
      const error = pred - row.y;
      
      x.forEach((xi, i) => {
        const update = lr * error * xi;
        if (isFinite(update)) {
          weights[i] -= update;
        }
      });
      
      const biasUpdate = lr * error;
      if (isFinite(biasUpdate)) {
        bias -= biasUpdate;
      }
    }
  }

  // Final validation - replace any NaN with 0
  weights.forEach((w, i) => { if (!isFinite(w)) weights[i] = 0; });
  if (!isFinite(bias)) bias = 0;

  return { weights, bias, scaler: { mean, std } };
}

// ═══════════════════════════════════════════════════════════════
// MODEL EVALUATION
// ═══════════════════════════════════════════════════════════════

interface EvalMetrics {
  accuracy: number;
  brier: number;
  ece: number;
}

function evaluateModel(
  model: TrainedModel,
  testData: DatasetRow[],
  featureNames: string[]
): EvalMetrics {
  if (testData.length === 0) {
    return { accuracy: 0, brier: 1, ece: 1 };
  }

  let correct = 0;
  let brierSum = 0;
  const calibrationBins: { count: number; correct: number; probSum: number }[] = 
    Array(10).fill(null).map(() => ({ count: 0, correct: 0, probSum: 0 }));

  for (const row of testData) {
    // Normalize features
    const x = featureNames.map((name, i) => {
      const mean = model.scaler.mean[i] || 0;
      const std = model.scaler.std[i] || 1;
      return ((row.features[name] || 0) - mean) / std;
    });
    
    // Predict
    const z = x.reduce((sum, xi, i) => sum + xi * (model.weights[i] || 0), 0) + model.bias;
    let prob = 1 / (1 + Math.exp(-z));
    
    // Handle NaN/Infinity
    if (isNaN(prob) || !isFinite(prob)) {
      prob = 0.5;
    }
    prob = Math.max(0.001, Math.min(0.999, prob)); // Clamp to valid range
    
    const pred = prob >= 0.5 ? 1 : 0;
    
    // Accuracy
    if (pred === row.y) correct++;
    
    // Brier score
    brierSum += Math.pow(prob - row.y, 2);
    
    // ECE calibration bins
    const binIdx = Math.min(9, Math.max(0, Math.floor(prob * 10)));
    calibrationBins[binIdx].count++;
    calibrationBins[binIdx].probSum += prob;
    if (row.y === 1) calibrationBins[binIdx].correct++;
  }

  const accuracy = correct / testData.length;
  const brier = brierSum / testData.length;
  
  // ECE calculation
  let ece = 0;
  for (const bin of calibrationBins) {
    if (bin.count > 0) {
      const avgProb = bin.probSum / bin.count;
      const avgCorrect = bin.correct / bin.count;
      ece += (bin.count / testData.length) * Math.abs(avgProb - avgCorrect);
    }
  }

  return { accuracy, brier, ece };
}

// ═══════════════════════════════════════════════════════════════
// RETRAIN JOB
// ═══════════════════════════════════════════════════════════════

export interface RetrainParams {
  fromTs?: number;
  toTs?: number;
  algo?: 'logreg' | 'tree';
  notes?: string;
}

export interface RetrainResult {
  runId: string;
  modelId: string;
  metrics: EvalMetrics;
  datasetRows: number;
}

export async function runRetrainJob(params: RetrainParams = {}): Promise<RetrainResult> {
  const runId = uuidv4();
  const startedAt = new Date();
  
  await MlRun.create({ 
    runId, 
    type: 'RETRAIN', 
    status: 'RUNNING', 
    startedAt,
    meta: params 
  });

  console.log(`[RetrainJob] Starting job ${runId}`, params);

  try {
    const algo = params.algo ?? 'logreg';
    const now = Date.now();
    const fromTs = params.fromTs ?? (now - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const toTs = params.toTs ?? now;

    // Build dataset
    const ds = await buildTrainSet({
      fromTs,
      toTs,
      split: { train: 0.7, val: 0.15, test: 0.15 },
    });

    console.log(`[RetrainJob] Dataset built: ${ds.totalRows} rows, ${ds.featureNames.length} features`);

    // Train model (only logreg for now)
    const trained = trainLogReg(ds.train, ds.featureNames);

    // Evaluate on test set
    const metrics = evaluateModel(trained, ds.test, ds.featureNames);

    console.log(`[RetrainJob] Model trained:`, metrics);

    // Create model in registry
    const modelId = uuidv4();

    await MlModelRegistry.create({
      modelId,
      stage: 'CANDIDATE',
      algo,
      dataset: {
        fromTs,
        toTs,
        rows: ds.totalRows,
        split: { train: 0.7, val: 0.15, test: 0.15 },
      },
      metrics: {
        accuracy: metrics.accuracy,
        brier: metrics.brier,
        ece: metrics.ece,
      },
      artifact: {
        weights: trained.weights,
        bias: trained.bias,
        scaler: trained.scaler,
        featureSchemaHash: ds.featureSchemaHash,
      },
      shadow: {
        critStreak: 0,
        degStreak: 0,
      },
      notes: params.notes,
    });

    // Update active state
    ActiveModelState.setCandidate(modelId);

    // Update run status
    await MlRun.updateOne(
      { runId },
      {
        $set: {
          status: 'DONE',
          finishedAt: new Date(),
          meta: { ...params, modelId, metrics, datasetRows: ds.totalRows },
        },
      }
    );

    console.log(`[RetrainJob] Completed job ${runId}, created model ${modelId}`);

    return { runId, modelId, metrics, datasetRows: ds.totalRows };
  } catch (e: any) {
    console.error(`[RetrainJob] Job ${runId} failed:`, e);
    
    await MlRun.updateOne(
      { runId },
      { $set: { status: 'FAILED', finishedAt: new Date(), error: String(e?.message ?? e) } }
    );
    throw e;
  }
}

console.log('[Phase 5.2] Retrain Job loaded');
