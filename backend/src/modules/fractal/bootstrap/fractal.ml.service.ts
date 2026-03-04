/**
 * BLOCK 27 + 29.13: ML Inference Service
 * Loads model from MongoDB and runs predictions (with scaler support)
 */

import { FractalMLModel } from '../data/schemas/fractal-ml-model.schema.js';

export interface MLPrediction {
  probUp: number;
  probDown: number;
}

interface CachedModel {
  symbol: string;
  version: string;
  type: string;
  weights: number[];
  bias: number;
  featureOrder: string[];
  scaler?: {
    mean: number[];
    scale: number[];
  };
  loadedAt: number;
}

export class FractalMLService {
  private modelCache: Map<string, CachedModel> = new Map();
  private CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Predict probability of UP movement
   * @param version - Model version ('ACTIVE' or 'v_xxx')
   */
  async predict(
    symbol: string,
    features: Record<string, number>,
    version = 'ACTIVE'
  ): Promise<MLPrediction | null> {
    const model = await this.getModel(symbol, version);
    if (!model) return null;

    // Build feature vector in correct order
    const xRaw = model.featureOrder.map(k => features[k] ?? 0);

    // Apply scaler if present (BLOCK 29.13)
    let x: number[];
    if (model.scaler && model.scaler.mean && model.scaler.scale) {
      x = xRaw.map((v, i) => {
        const mean = model.scaler!.mean[i] ?? 0;
        const scale = model.scaler!.scale[i] ?? 1;
        return (v - mean) / (scale || 1);
      });
    } else {
      x = xRaw;
    }

    // Logistic regression: z = bias + sum(w_i * x_i)
    let z = model.bias;
    for (let i = 0; i < x.length; i++) {
      z += x[i] * (model.weights[i] ?? 0);
    }

    // Sigmoid
    const prob = 1 / (1 + Math.exp(-z));

    return {
      probUp: prob,
      probDown: 1 - prob
    };
  }

  /**
   * Save model weights from Python training
   * @param version - Model version (default: 'ACTIVE')
   */
  async saveModel(
    symbol: string,
    weights: number[],
    bias: number,
    featureOrder: string[],
    trainStats?: {
      samples: number;
      accuracy: number;
      auc?: number;
    },
    version = 'ACTIVE',
    scaler?: { mean: number[]; scale: number[] },
    type = 'logreg'
  ): Promise<void> {
    const modelDoc: any = {
      symbol,
      version,
      type: scaler ? 'logreg_scaled' : type,
      weights,
      bias,
      featureOrder,
      trainStats: trainStats ? {
        ...trainStats,
        trainDate: new Date()
      } : undefined,
      updatedAt: new Date()
    };

    if (scaler) {
      modelDoc.scaler = scaler;
    }

    await FractalMLModel.updateOne(
      { symbol, version },
      { $set: modelDoc },
      { upsert: true }
    );

    // Invalidate cache for this version
    this.modelCache.delete(`${symbol}:${version}`);
  }

  /**
   * Get model info
   */
  async getModelInfo(symbol: string, version = 'ACTIVE'): Promise<{
    exists: boolean;
    version?: string;
    type?: string;
    featureCount?: number;
    hasScaler?: boolean;
    trainStats?: any;
  }> {
    const model = await FractalMLModel.findOne({ symbol, version }).lean();
    if (!model) return { exists: false };

    return {
      exists: true,
      version: model.version,
      type: model.type,
      featureCount: model.weights?.length ?? 0,
      hasScaler: !!(model.scaler?.mean?.length),
      trainStats: model.trainStats
    };
  }

  /**
   * Copy model from one version to another (e.g., SHADOW -> ACTIVE)
   */
  async copyModel(symbol: string, fromVersion: string, toVersion: string): Promise<boolean> {
    const source = await FractalMLModel.findOne({ symbol, version: fromVersion }).lean();
    if (!source) return false;

    const { _id, ...rest } = source as any;

    await FractalMLModel.updateOne(
      { symbol, version: toVersion },
      { $set: { ...rest, version: toVersion, updatedAt: new Date() } },
      { upsert: true }
    );

    // Invalidate cache
    this.modelCache.delete(`${symbol}:${toVersion}`);
    return true;
  }

  private async getModel(symbol: string, version = 'ACTIVE'): Promise<CachedModel | null> {
    const now = Date.now();
    const cacheKey = `${symbol}:${version}`;

    // Check cache
    const cached = this.modelCache.get(cacheKey);
    if (cached && now - cached.loadedAt < this.CACHE_TTL_MS) {
      return cached;
    }

    // Load from DB
    const model = await FractalMLModel.findOne({ symbol, version }).lean();
    if (!model || !model.weights || !model.featureOrder) {
      return null;
    }

    const entry: CachedModel = {
      symbol,
      version,
      type: model.type ?? 'logreg',
      weights: model.weights,
      bias: model.bias ?? 0,
      featureOrder: model.featureOrder,
      loadedAt: now
    };

    // Include scaler if present
    if (model.scaler?.mean?.length && model.scaler?.scale?.length) {
      entry.scaler = {
        mean: model.scaler.mean,
        scale: model.scaler.scale
      };
    }

    this.modelCache.set(cacheKey, entry);
    return entry;
  }
}
