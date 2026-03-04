/**
 * Exchange Auto-Learning Loop - PR2: Trainer Service
 * 
 * Core training service for WIN/LOSS classification models.
 * 
 * Features:
 * - Logistic Regression as default algorithm
 * - Train/Valid/Test split with no lookahead
 * - Automatic metric calculation
 * - Model artifact generation
 */

import { Db, Collection, ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  ExchangeModel,
  ExchangeTrainingRun,
  ModelMetrics,
  ModelArtifact,
  ModelAlgo,
  TrainingRunStatus,
  TrainerConfig,
  DEFAULT_TRAINER_CONFIG,
} from './exchange_training.types.js';
import { ExchangeSample, ExchangeHorizon, LabelResult } from '../dataset/exchange_dataset.types.js';
import { getExchangeDatasetService } from '../dataset/exchange_dataset.service.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MODELS_COLLECTION = 'exch_models';
const TRAINING_RUNS_COLLECTION = 'exch_training_runs';

// Feature names for model (same order as rawVector in feature builder)
const FEATURE_NAMES = [
  'priceChange24h',
  'priceChange7d',
  'volumeRatio',
  'rsi14',
  'macdSignal',
  'bbWidth',
  'fundingRate',
  'oiChange24h',
  'sentimentScore',
  'regimeConfidence',
  'btcCorrelation',
  'marketStress',
];

// ═══════════════════════════════════════════════════════════════
// TRAINING EXAMPLE TYPE
// ═══════════════════════════════════════════════════════════════

interface TrainingExample {
  features: number[];
  label: LabelResult;
  sampleId: string;
  symbol: string;
  t0: Date;
}

// ═══════════════════════════════════════════════════════════════
// TRAINER SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export class ExchangeTrainerService {
  private modelsCollection: Collection<ExchangeModel>;
  private runsCollection: Collection<ExchangeTrainingRun>;
  private config: TrainerConfig;
  
  constructor(private db: Db, config?: Partial<TrainerConfig>) {
    this.modelsCollection = db.collection<ExchangeModel>(MODELS_COLLECTION);
    this.runsCollection = db.collection<ExchangeTrainingRun>(TRAINING_RUNS_COLLECTION);
    this.config = { ...DEFAULT_TRAINER_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    // Models collection indexes
    await this.modelsCollection.createIndex(
      { modelId: 1 },
      { unique: true, name: 'idx_model_id' }
    );
    
    await this.modelsCollection.createIndex(
      { horizon: 1, version: -1 },
      { name: 'idx_horizon_version' }
    );
    
    await this.modelsCollection.createIndex(
      { horizon: 1, status: 1 },
      { name: 'idx_horizon_status' }
    );
    
    // Training runs collection indexes
    await this.runsCollection.createIndex(
      { runId: 1 },
      { unique: true, name: 'idx_run_id' }
    );
    
    await this.runsCollection.createIndex(
      { horizon: 1, status: 1 },
      { name: 'idx_runs_horizon_status' }
    );
    
    await this.runsCollection.createIndex(
      { createdAt: -1 },
      { name: 'idx_runs_created' }
    );
    
    console.log('[ExchangeTrainerService] Indexes ensured');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MAIN TRAINING METHOD
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Train a model for a specific horizon.
   * 
   * @param horizon - Forecast horizon ('1D', '7D', '30D')
   * @param trigger - What triggered training
   * @param algo - Algorithm to use (default: LOGISTIC_REGRESSION)
   */
  async trainModel(params: {
    horizon: ExchangeHorizon;
    trigger: 'MANUAL' | 'SCHEDULED' | 'THRESHOLD';
    algo?: ModelAlgo;
  }): Promise<{ runId: string; modelId: string | null; success: boolean; error?: string }> {
    const { horizon, trigger, algo = this.config.defaultAlgo } = params;
    
    const runId = `run_${horizon}_${Date.now()}`;
    const now = new Date();
    
    // Create training run record
    const run: ExchangeTrainingRun = {
      runId,
      horizon,
      algo,
      trigger,
      status: 'RUNNING',
      startedAt: now,
      completedAt: null,
      progress: {
        phase: 'LOADING',
        percent: 0,
        message: 'Starting training run...',
      },
      createdAt: now,
      updatedAt: now,
    };
    
    await this.runsCollection.insertOne(run as any);
    console.log(`[Trainer] Training run started: ${runId} for ${horizon}`);
    
    try {
      // Phase 1: Load data
      await this.updateRunProgress(runId, 'LOADING', 10, 'Loading resolved samples...');
      
      const datasetService = getExchangeDatasetService(this.db);
      const samples = await datasetService.getResolvedSamples({
        horizon,
        limit: 10000, // Max samples
      });
      
      console.log(`[Trainer] Loaded ${samples.length} resolved samples for ${horizon}`);
      
      if (samples.length < this.config.minSamples) {
        throw new Error(`Not enough samples: ${samples.length} < ${this.config.minSamples}`);
      }
      
      // Phase 2: Prepare and split data
      await this.updateRunProgress(runId, 'SPLITTING', 20, 'Splitting dataset...');
      
      const examples = this.prepareExamples(samples);
      const { train, valid, test } = this.splitData(examples);
      
      console.log(`[Trainer] Data split: train=${train.length}, valid=${valid.length}, test=${test.length}`);
      
      // Update run with dataset stats
      await this.runsCollection.updateOne(
        { runId },
        {
          $set: {
            datasetStats: {
              totalSamples: samples.length,
              trainSize: train.length,
              validSize: valid.length,
              testSize: test.length,
              labelDistribution: this.getLabelDistribution(examples),
            },
            updatedAt: new Date(),
          },
        }
      );
      
      // Phase 3: Train model
      await this.updateRunProgress(runId, 'TRAINING', 40, 'Training model...');
      
      const { weights, bias, normalization } = await this.trainLogisticRegression(train, valid);
      
      console.log(`[Trainer] Model trained`);
      
      // Phase 4: Evaluate on test set
      await this.updateRunProgress(runId, 'EVALUATING', 70, 'Evaluating model...');
      
      const metrics = this.evaluateModel(weights, bias, normalization, test);
      
      console.log(`[Trainer] Evaluation: accuracy=${metrics.accuracy.toFixed(3)}, f1=${metrics.f1Score.toFixed(3)}`);
      
      // Phase 5: Save model
      await this.updateRunProgress(runId, 'SAVING', 90, 'Saving model artifact...');
      
      const modelId = await this.saveModel({
        horizon,
        algo,
        runId,
        weights,
        bias,
        normalization,
        metrics,
        datasetInfo: {
          totalSamples: samples.length,
          trainSize: train.length,
          validSize: valid.length,
          testSize: test.length,
          dateRange: {
            from: new Date(Math.min(...samples.map(s => s.t0.getTime()))),
            to: new Date(Math.max(...samples.map(s => s.t0.getTime()))),
          },
        },
      });
      
      // Mark run as completed
      await this.runsCollection.updateOne(
        { runId },
        {
          $set: {
            status: 'COMPLETED' as TrainingRunStatus,
            completedAt: new Date(),
            progress: { phase: 'SAVING', percent: 100, message: 'Training complete' },
            resultModelId: modelId,
            metrics,
            durationMs: Date.now() - now.getTime(),
            updatedAt: new Date(),
          },
        }
      );
      
      console.log(`[Trainer] Training complete: ${runId} -> model ${modelId}`);
      
      return { runId, modelId, success: true };
      
    } catch (err: any) {
      console.error(`[Trainer] Training failed: ${runId}`, err);
      
      await this.runsCollection.updateOne(
        { runId },
        {
          $set: {
            status: 'FAILED' as TrainingRunStatus,
            completedAt: new Date(),
            error: err.message || 'Unknown error',
            durationMs: Date.now() - now.getTime(),
            updatedAt: new Date(),
          },
        }
      );
      
      return { runId, modelId: null, success: false, error: err.message };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DATA PREPARATION
  // ═══════════════════════════════════════════════════════════════
  
  private prepareExamples(samples: ExchangeSample[]): TrainingExample[] {
    const examples: TrainingExample[] = [];
    
    for (const sample of samples) {
      // Skip samples without proper features or label
      if (!sample.features.rawVector || sample.features.rawVector.length === 0) {
        continue;
      }
      if (!sample.label || sample.label === 'NEUTRAL') {
        continue; // Skip NEUTRAL for binary-ish classification
      }
      
      examples.push({
        features: sample.features.rawVector,
        label: sample.label,
        sampleId: sample._id?.toString() || '',
        symbol: sample.symbol,
        t0: sample.t0,
      });
    }
    
    return examples;
  }
  
  private splitData(examples: TrainingExample[]): {
    train: TrainingExample[];
    valid: TrainingExample[];
    test: TrainingExample[];
  } {
    // Sort by time to prevent lookahead
    const sorted = [...examples].sort((a, b) => a.t0.getTime() - b.t0.getTime());
    
    const trainEnd = Math.floor(sorted.length * this.config.trainRatio);
    const validEnd = Math.floor(sorted.length * (this.config.trainRatio + this.config.validRatio));
    
    return {
      train: sorted.slice(0, trainEnd),
      valid: sorted.slice(trainEnd, validEnd),
      test: sorted.slice(validEnd),
    };
  }
  
  private getLabelDistribution(examples: TrainingExample[]): Record<string, number> {
    const dist: Record<string, number> = { WIN: 0, LOSS: 0, NEUTRAL: 0 };
    for (const ex of examples) {
      dist[ex.label] = (dist[ex.label] || 0) + 1;
    }
    return dist;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // LOGISTIC REGRESSION TRAINING
  // ═══════════════════════════════════════════════════════════════
  
  private async trainLogisticRegression(
    train: TrainingExample[],
    valid: TrainingExample[]
  ): Promise<{
    weights: number[];
    bias: number;
    normalization: Record<string, { mean: number; std: number }>;
  }> {
    const lr = this.config.logisticRegression;
    
    // Calculate normalization params from training data
    const normalization = this.calculateNormalization(train);
    
    // Normalize features
    const normalizedTrain = this.normalizeFeatures(train, normalization);
    const normalizedValid = this.normalizeFeatures(valid, normalization);
    
    const numFeatures = normalizedTrain[0].features.length;
    
    // Initialize weights with small random values
    let weights = Array(numFeatures).fill(0).map(() => (Math.random() - 0.5) * 0.1);
    let bias = 0;
    
    let bestValidLoss = Infinity;
    let bestWeights = [...weights];
    let bestBias = bias;
    let patienceCounter = 0;
    
    // Training loop
    for (let epoch = 0; epoch < lr.epochs; epoch++) {
      // Shuffle training data
      const shuffled = [...normalizedTrain].sort(() => Math.random() - 0.5);
      
      // Mini-batch gradient descent
      for (const example of shuffled) {
        const target = example.label === 'WIN' ? 1 : 0;
        const pred = this.sigmoid(this.dotProduct(weights, example.features) + bias);
        const error = pred - target;
        
        // Update weights with L2 regularization
        for (let i = 0; i < numFeatures; i++) {
          weights[i] -= lr.learningRate * (error * example.features[i] + lr.regularization * weights[i]);
        }
        bias -= lr.learningRate * error;
      }
      
      // Validate
      const validLoss = this.calculateLoss(weights, bias, normalizedValid);
      
      if (validLoss < bestValidLoss) {
        bestValidLoss = validLoss;
        bestWeights = [...weights];
        bestBias = bias;
        patienceCounter = 0;
      } else {
        patienceCounter++;
        if (patienceCounter >= lr.earlyStopPatience) {
          console.log(`[Trainer] Early stopping at epoch ${epoch}`);
          break;
        }
      }
    }
    
    return {
      weights: bestWeights,
      bias: bestBias,
      normalization,
    };
  }
  
  private calculateNormalization(examples: TrainingExample[]): Record<string, { mean: number; std: number }> {
    if (examples.length === 0 || examples[0].features.length === 0) {
      return {};
    }
    
    const numFeatures = examples[0].features.length;
    const result: Record<string, { mean: number; std: number }> = {};
    
    for (let i = 0; i < numFeatures; i++) {
      const featureName = FEATURE_NAMES[i] || `feature_${i}`;
      const values = examples.map(e => e.features[i]);
      
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      const std = Math.sqrt(variance) || 1; // Avoid division by zero
      
      result[featureName] = { mean, std };
    }
    
    return result;
  }
  
  private normalizeFeatures(
    examples: TrainingExample[],
    normalization: Record<string, { mean: number; std: number }>
  ): TrainingExample[] {
    return examples.map(ex => ({
      ...ex,
      features: ex.features.map((v, i) => {
        const featureName = FEATURE_NAMES[i] || `feature_${i}`;
        const { mean, std } = normalization[featureName] || { mean: 0, std: 1 };
        return (v - mean) / std;
      }),
    }));
  }
  
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
  }
  
  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, v, i) => sum + v * (b[i] || 0), 0);
  }
  
  private calculateLoss(weights: number[], bias: number, examples: TrainingExample[]): number {
    let loss = 0;
    for (const ex of examples) {
      const target = ex.label === 'WIN' ? 1 : 0;
      const pred = this.sigmoid(this.dotProduct(weights, ex.features) + bias);
      loss -= target * Math.log(pred + 1e-10) + (1 - target) * Math.log(1 - pred + 1e-10);
    }
    return loss / examples.length;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MODEL EVALUATION
  // ═══════════════════════════════════════════════════════════════
  
  private evaluateModel(
    weights: number[],
    bias: number,
    normalization: Record<string, { mean: number; std: number }>,
    test: TrainingExample[]
  ): ModelMetrics {
    // Normalize test data
    const normalizedTest = this.normalizeFeatures(test, normalization);
    
    // Predictions
    const predictions: Array<{ actual: LabelResult; predicted: LabelResult; prob: number }> = [];
    
    for (const ex of normalizedTest) {
      const prob = this.sigmoid(this.dotProduct(weights, ex.features) + bias);
      const predicted: LabelResult = prob >= this.config.winThreshold ? 'WIN' : 'LOSS';
      predictions.push({ actual: ex.label, predicted, prob });
    }
    
    // Confusion matrix (2x2 for WIN/LOSS)
    const cm = {
      TP: 0, // Predicted WIN, Actual WIN
      FP: 0, // Predicted WIN, Actual LOSS
      TN: 0, // Predicted LOSS, Actual LOSS
      FN: 0, // Predicted LOSS, Actual WIN
    };
    
    for (const p of predictions) {
      if (p.predicted === 'WIN' && p.actual === 'WIN') cm.TP++;
      else if (p.predicted === 'WIN' && p.actual === 'LOSS') cm.FP++;
      else if (p.predicted === 'LOSS' && p.actual === 'LOSS') cm.TN++;
      else if (p.predicted === 'LOSS' && p.actual === 'WIN') cm.FN++;
    }
    
    const total = predictions.length;
    const accuracy = (cm.TP + cm.TN) / total;
    const precision = cm.TP / (cm.TP + cm.FP) || 0;
    const recall = cm.TP / (cm.TP + cm.FN) || 0;
    const f1Score = 2 * precision * recall / (precision + recall) || 0;
    
    // Win rate calculations
    const actualWins = predictions.filter(p => p.actual === 'WIN').length;
    const predictedWins = predictions.filter(p => p.predicted === 'WIN').length;
    const winRate = predictedWins > 0 ? cm.TP / predictedWins : 0;
    const expectedWinRate = predictions.reduce((sum, p) => sum + p.prob, 0) / total;
    
    // Brier score
    const brierScore = predictions.reduce((sum, p) => {
      const target = p.actual === 'WIN' ? 1 : 0;
      return sum + Math.pow(p.prob - target, 2);
    }, 0) / total;
    
    return {
      accuracy,
      precision,
      recall,
      f1Score,
      winRate,
      expectedWinRate,
      brierScore,
      classMetrics: {
        WIN: {
          precision,
          recall,
          support: actualWins,
        },
        LOSS: {
          precision: cm.TN / (cm.TN + cm.FN) || 0,
          recall: cm.TN / (cm.TN + cm.FP) || 0,
          support: total - actualWins,
        },
        NEUTRAL: {
          precision: 0,
          recall: 0,
          support: 0,
        },
      },
      confusionMatrix: [
        [cm.TP, cm.FP, 0], // Predicted WIN
        [cm.FN, cm.TN, 0], // Predicted LOSS
        [0, 0, 0],         // NEUTRAL (not used)
      ],
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MODEL PERSISTENCE
  // ═══════════════════════════════════════════════════════════════
  
  private async saveModel(params: {
    horizon: ExchangeHorizon;
    algo: ModelAlgo;
    runId: string;
    weights: number[];
    bias: number;
    normalization: Record<string, { mean: number; std: number }>;
    metrics: ModelMetrics;
    datasetInfo: ExchangeModel['datasetInfo'];
  }): Promise<string> {
    const { horizon, algo, runId, weights, bias, normalization, metrics, datasetInfo } = params;
    
    // Get next version number
    const latestModel = await this.modelsCollection
      .find({ horizon })
      .sort({ version: -1 })
      .limit(1)
      .toArray();
    
    const version = (latestModel[0]?.version || 0) + 1;
    
    const modelId = `${horizon}_${algo}_${Date.now()}`;
    const now = new Date();
    
    const model: ExchangeModel = {
      modelId,
      horizon,
      algo,
      version,
      status: 'READY', // Ready for shadow evaluation
      trainingRunId: runId,
      trainedAt: now,
      datasetInfo,
      metrics,
      artifact: {
        type: algo,
        weights,
        bias,
        thresholds: {
          winThreshold: this.config.winThreshold,
          lossThreshold: this.config.lossThreshold,
        },
      },
      featureConfig: {
        version: 'v1.0.0',
        features: FEATURE_NAMES,
        normalization,
      },
      createdAt: now,
      updatedAt: now,
      promotedAt: null,
      retiredAt: null,
    };
    
    await this.modelsCollection.insertOne(model as any);
    
    console.log(`[Trainer] Model saved: ${modelId} (v${version})`);
    
    return modelId;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private async updateRunProgress(
    runId: string,
    phase: ExchangeTrainingRun['progress']['phase'],
    percent: number,
    message: string
  ): Promise<void> {
    await this.runsCollection.updateOne(
      { runId },
      {
        $set: {
          progress: { phase, percent, message },
          updatedAt: new Date(),
        },
      }
    );
  }
  
  // ═══════════════════════════════════════════════════════════════
  // QUERY METHODS
  // ═══════════════════════════════════════════════════════════════
  
  async getModel(modelId: string): Promise<ExchangeModel | null> {
    return this.modelsCollection.findOne({ modelId }) as Promise<ExchangeModel | null>;
  }
  
  async getLatestModel(horizon: ExchangeHorizon): Promise<ExchangeModel | null> {
    const models = await this.modelsCollection
      .find({ horizon, status: { $in: ['READY', 'ACTIVE', 'SHADOW'] } })
      .sort({ version: -1 })
      .limit(1)
      .toArray();
    
    return models[0] as ExchangeModel || null;
  }
  
  async getModelsByHorizon(horizon: ExchangeHorizon): Promise<ExchangeModel[]> {
    return this.modelsCollection
      .find({ horizon })
      .sort({ version: -1 })
      .toArray() as Promise<ExchangeModel[]>;
  }
  
  async getTrainingRun(runId: string): Promise<ExchangeTrainingRun | null> {
    return this.runsCollection.findOne({ runId }) as Promise<ExchangeTrainingRun | null>;
  }
  
  async getRecentRuns(limit: number = 10): Promise<ExchangeTrainingRun[]> {
    return this.runsCollection
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray() as Promise<ExchangeTrainingRun[]>;
  }
  
  async getRunsByHorizon(horizon: ExchangeHorizon, limit: number = 10): Promise<ExchangeTrainingRun[]> {
    return this.runsCollection
      .find({ horizon })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray() as Promise<ExchangeTrainingRun[]>;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════
  
  async getStats(): Promise<{
    totalModels: number;
    byHorizon: Record<ExchangeHorizon, number>;
    byStatus: Record<string, number>;
    totalRuns: number;
    recentRuns: ExchangeTrainingRun[];
  }> {
    const [modelCounts, statusCounts, totalRuns, recentRuns] = await Promise.all([
      this.modelsCollection.aggregate([
        { $group: { _id: '$horizon', count: { $sum: 1 } } },
      ]).toArray(),
      this.modelsCollection.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]).toArray(),
      this.runsCollection.countDocuments({}),
      this.getRecentRuns(5),
    ]);
    
    const byHorizon: Record<ExchangeHorizon, number> = { '1D': 0, '7D': 0, '30D': 0 };
    for (const item of modelCounts) {
      byHorizon[item._id as ExchangeHorizon] = item.count;
    }
    
    const byStatus: Record<string, number> = {};
    for (const item of statusCounts) {
      byStatus[item._id] = item.count;
    }
    
    return {
      totalModels: Object.values(byHorizon).reduce((a, b) => a + b, 0),
      byHorizon,
      byStatus,
      totalRuns,
      recentRuns,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let trainerInstance: ExchangeTrainerService | null = null;

export function getExchangeTrainerService(db: Db): ExchangeTrainerService {
  if (!trainerInstance) {
    trainerInstance = new ExchangeTrainerService(db);
  }
  return trainerInstance;
}

console.log('[Exchange ML] Trainer service loaded');
