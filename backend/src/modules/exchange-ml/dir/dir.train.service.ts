/**
 * Direction Training Service
 * ==========================
 * 
 * Trains Direction Models per horizon and manages model lifecycle.
 */

import { Db, Collection, ObjectId } from 'mongodb';
import { Horizon, DirLabel, DirFeatureSnapshot } from '../contracts/exchange.types.js';
import { trainDirLogistic, TrainedDirModel, prepareDirTrainingData } from './dir.trainer.js';
import { analyzeLabelDistribution } from './dir.labeler.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MIN_SAMPLES = 100;      // Minimum samples for training
const TRAIN_TEST_SPLIT = 0.8; // 80% train, 20% test

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface TrainResult {
  success: boolean;
  horizon: Horizon;
  model?: {
    version: string;
    accuracy: number;
    trainingSize: number;
    classDistribution: Record<DirLabel, number>;
  };
  modelId?: string;
  error?: string;
  trainMetrics?: {
    trainAccuracy: number;
    testAccuracy: number;
    overfitRatio: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// TRAINING SERVICE
// ═══════════════════════════════════════════════════════════════

export class DirTrainService {
  private samplesCollection: Collection;
  private modelsCollection: Collection;
  private registryCollection: Collection;
  
  constructor(private db: Db) {
    this.samplesCollection = db.collection('exch_dir_samples');
    this.modelsCollection = db.collection('exch_dir_models');
    this.registryCollection = db.collection('exch_dir_registry');
  }
  
  /**
   * Ensure indexes exist
   */
  async ensureIndexes(): Promise<void> {
    await this.modelsCollection.createIndex({ horizon: 1, trainedAt: -1 });
    await this.modelsCollection.createIndex({ version: 1 }, { unique: true });
    
    await this.registryCollection.createIndex({ horizon: 1 }, { unique: true });
    
    console.log('[DirTrainService] Indexes ensured');
  }
  
  /**
   * Train Direction Model for a specific horizon
   */
  async trainForHorizon(params: {
    horizon: Horizon;
    symbol?: string; // Optional: filter by symbol
    minDate?: Date;
    maxDate?: Date;
  }): Promise<TrainResult> {
    const { horizon, symbol, minDate, maxDate } = params;
    
    console.log(`[DirTrainService] Starting training for ${horizon}`);
    
    try {
      // Fetch resolved samples
      const query: any = {
        horizon,
        status: 'RESOLVED',
        label: { $ne: null },
      };
      
      if (symbol) {
        query.symbol = symbol.toUpperCase();
      }
      
      if (minDate || maxDate) {
        query.t0 = {};
        if (minDate) query.t0.$gte = minDate;
        if (maxDate) query.t0.$lte = maxDate;
      }
      
      const samples = await this.samplesCollection
        .find(query)
        .sort({ t0: 1 })
        .toArray();
      
      console.log(`[DirTrainService] Found ${samples.length} samples for ${horizon}`);
      
      // Check minimum samples
      if (samples.length < MIN_SAMPLES) {
        return {
          success: false,
          horizon,
          error: `Not enough samples: ${samples.length} < ${MIN_SAMPLES}`,
        };
      }
      
      // Analyze label distribution
      const labels = samples.map(s => s.label as DirLabel);
      const distribution = analyzeLabelDistribution(labels);
      
      console.log(`[DirTrainService] Label distribution for ${horizon}:`);
      console.log(`  UP: ${distribution.upPct.toFixed(1)}%`);
      console.log(`  DOWN: ${distribution.downPct.toFixed(1)}%`);
      console.log(`  NEUTRAL: ${distribution.neutralPct.toFixed(1)}%`);
      console.log(`  Coverage: ${distribution.coverage.toFixed(1)}%`);
      
      // Split train/test (time-based, not random)
      const splitIdx = Math.floor(samples.length * TRAIN_TEST_SPLIT);
      const trainSamples = samples.slice(0, splitIdx);
      const testSamples = samples.slice(splitIdx);
      
      console.log(`[DirTrainService] Train: ${trainSamples.length}, Test: ${testSamples.length}`);
      
      // Prepare training data
      const trainData = prepareDirTrainingData(
        trainSamples.map(s => ({
          features: s.features as DirFeatureSnapshot,
          label: s.label as DirLabel,
        }))
      );
      
      // Train model
      const model = trainDirLogistic(trainData, horizon, {
        learningRate: 0.1,
        iterations: 200,
        l2Lambda: 0.01,
      });
      
      // Evaluate on test set
      const testData = prepareDirTrainingData(
        testSamples.map(s => ({
          features: s.features as DirFeatureSnapshot,
          label: s.label as DirLabel,
        }))
      );
      
      let testCorrect = 0;
      for (const example of testData) {
        const x = [...example.features, 1];
        const logits = model.weights.map(w => w.reduce((sum, wi, i) => sum + wi * (x[i] ?? 0), 0));
        const maxIdx = logits.indexOf(Math.max(...logits));
        const pred = model.classes[maxIdx];
        if (pred === example.label) testCorrect++;
      }
      const testAccuracy = testCorrect / testData.length;
      
      const overfitRatio = model.accuracy / testAccuracy;
      
      console.log(`[DirTrainService] Train accuracy: ${(model.accuracy * 100).toFixed(1)}%`);
      console.log(`[DirTrainService] Test accuracy: ${(testAccuracy * 100).toFixed(1)}%`);
      console.log(`[DirTrainService] Overfit ratio: ${overfitRatio.toFixed(2)}`);
      
      // Save model
      const modelDoc = {
        ...model,
        trainedAt: new Date(),
        testAccuracy,
        overfitRatio,
      };
      
      const insertResult = await this.modelsCollection.insertOne(modelDoc);
      const modelId = insertResult.insertedId.toString();
      
      console.log(`[DirTrainService] Model saved: ${model.version}`);
      
      return {
        success: true,
        horizon,
        model: {
          version: model.version,
          accuracy: testAccuracy, // Report test accuracy
          trainingSize: model.trainingSize,
          classDistribution: model.classDistribution,
        },
        modelId,
        trainMetrics: {
          trainAccuracy: model.accuracy,
          testAccuracy,
          overfitRatio,
        },
      };
      
    } catch (err: any) {
      console.error(`[DirTrainService] Training failed for ${horizon}:`, err);
      return {
        success: false,
        horizon,
        error: err.message,
      };
    }
  }
  
  /**
   * Train models for all horizons
   */
  async trainAll(params?: {
    symbol?: string;
    minDate?: Date;
    maxDate?: Date;
  }): Promise<TrainResult[]> {
    const horizons: Horizon[] = ['1D', '7D', '30D'];
    const results: TrainResult[] = [];
    
    for (const horizon of horizons) {
      const result = await this.trainForHorizon({
        horizon,
        ...params,
      });
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * Set a model as active for a horizon
   */
  async activateModel(horizon: Horizon, modelId: string): Promise<boolean> {
    // Verify model exists
    const model = await this.modelsCollection.findOne({
      _id: new ObjectId(modelId),
    });
    
    if (!model) {
      console.error(`[DirTrainService] Model not found: ${modelId}`);
      return false;
    }
    
    // Get current active model
    const registry = await this.registryCollection.findOne({ horizon });
    const prevActiveId = registry?.activeModelId;
    
    // Update registry
    await this.registryCollection.updateOne(
      { horizon },
      {
        $set: {
          activeModelId: modelId,
          activeModelVersion: model.version,
          prevModelId: prevActiveId,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    
    console.log(`[DirTrainService] Activated model ${model.version} for ${horizon}`);
    
    return true;
  }
  
  /**
   * Set a model as shadow for a horizon
   */
  async setShadowModel(horizon: Horizon, modelId: string): Promise<boolean> {
    const model = await this.modelsCollection.findOne({
      _id: new ObjectId(modelId),
    });
    
    if (!model) return false;
    
    await this.registryCollection.updateOne(
      { horizon },
      {
        $set: {
          shadowModelId: modelId,
          shadowModelVersion: model.version,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    
    console.log(`[DirTrainService] Set shadow model ${model.version} for ${horizon}`);
    
    return true;
  }
  
  /**
   * Get registry state for all horizons
   */
  async getRegistryState(): Promise<Record<Horizon, {
    activeModelId: string | null;
    activeModelVersion: string | null;
    shadowModelId: string | null;
    shadowModelVersion: string | null;
    updatedAt: Date | null;
  }>> {
    const result: any = {
      '1D': { activeModelId: null, activeModelVersion: null, shadowModelId: null, shadowModelVersion: null, updatedAt: null },
      '7D': { activeModelId: null, activeModelVersion: null, shadowModelId: null, shadowModelVersion: null, updatedAt: null },
      '30D': { activeModelId: null, activeModelVersion: null, shadowModelId: null, shadowModelVersion: null, updatedAt: null },
    };
    
    const entries = await this.registryCollection.find({}).toArray();
    
    for (const entry of entries) {
      const h = entry.horizon as Horizon;
      if (result[h]) {
        result[h] = {
          activeModelId: entry.activeModelId || null,
          activeModelVersion: entry.activeModelVersion || null,
          shadowModelId: entry.shadowModelId || null,
          shadowModelVersion: entry.shadowModelVersion || null,
          updatedAt: entry.updatedAt || null,
        };
      }
    }
    
    return result;
  }
  
  /**
   * Get model by ID
   */
  async getModel(modelId: string): Promise<TrainedDirModel | null> {
    try {
      const model = await this.modelsCollection.findOne({
        _id: new ObjectId(modelId),
      });
      return model as TrainedDirModel | null;
    } catch {
      return null;
    }
  }
  
  /**
   * List recent models for a horizon
   */
  async listModels(horizon: Horizon, limit: number = 10): Promise<Array<{
    id: string;
    version: string;
    trainedAt: Date;
    accuracy: number;
    testAccuracy: number;
    trainingSize: number;
  }>> {
    const models = await this.modelsCollection
      .find({ horizon })
      .sort({ trainedAt: -1 })
      .limit(limit)
      .toArray();
    
    return models.map(m => ({
      id: m._id.toString(),
      version: m.version,
      trainedAt: m.trainedAt,
      accuracy: m.accuracy,
      testAccuracy: m.testAccuracy ?? m.accuracy,
      trainingSize: m.trainingSize,
    }));
  }
}

console.log('[Exchange ML] Direction training service loaded');
