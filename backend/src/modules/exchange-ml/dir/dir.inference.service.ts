/**
 * Direction Inference Service
 * ===========================
 * 
 * Performs direction prediction using trained model.
 * Integrates with model registry for active/shadow model management.
 */

import { Db, Collection, ObjectId } from 'mongodb';
import { Horizon, ExchangeDirPrediction } from '../contracts/exchange.types.js';
import { TrainedDirModel, predictWithDirModel } from './dir.trainer.js';
import { buildDirFeatures, DirFeatureDeps } from './dir.feature-extractor.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MODELS_COLLECTION = 'exch_dir_models';
const REGISTRY_COLLECTION = 'exch_dir_registry';

// ═══════════════════════════════════════════════════════════════
// SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export class DirInferenceService {
  private modelsCollection: Collection;
  private registryCollection: Collection;
  
  // Model cache (TTL-based)
  private modelCache: Map<string, { model: TrainedDirModel; loadedAt: number }> = new Map();
  private cacheTTL = 60 * 1000; // 60 seconds
  
  constructor(
    private db: Db,
    private featureDeps: DirFeatureDeps
  ) {
    this.modelsCollection = db.collection(MODELS_COLLECTION);
    this.registryCollection = db.collection(REGISTRY_COLLECTION);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    await this.modelsCollection.createIndex({ horizon: 1, trainedAt: -1 });
    await this.modelsCollection.createIndex({ version: 1 }, { unique: true });
    
    await this.registryCollection.createIndex(
      { horizon: 1 },
      { unique: true }
    );
    
    console.log('[DirInferenceService] Indexes ensured');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PREDICTION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Predict direction for a symbol/horizon.
   */
  async predict(params: {
    symbol: string;
    horizon: Horizon;
    t?: number; // unix seconds, default = now
  }): Promise<ExchangeDirPrediction> {
    const { symbol, horizon, t = Math.floor(Date.now() / 1000) } = params;
    
    // Get active model
    const model = await this.getActiveModel(horizon);
    
    if (!model) {
      // No model trained yet - return neutral
      console.warn(`[DirInferenceService] No model for ${horizon}, returning NEUTRAL`);
      return {
        label: 'NEUTRAL',
        proba: { UP: 0.33, DOWN: 0.33, NEUTRAL: 0.34 },
        confidence: 0.34,
      };
    }
    
    // Build features
    const features = await buildDirFeatures(this.featureDeps, { symbol, t, horizon });
    
    // Predict
    const result = predictWithDirModel(model, features);
    
    return {
      label: result.label,
      proba: result.proba,
      confidence: result.confidence,
    };
  }
  
  /**
   * Predict with both active and shadow models.
   */
  async predictWithShadow(params: {
    symbol: string;
    horizon: Horizon;
    t?: number;
  }): Promise<{
    active: ExchangeDirPrediction;
    shadow: ExchangeDirPrediction | null;
  }> {
    const { symbol, horizon, t = Math.floor(Date.now() / 1000) } = params;
    
    // Build features once
    const features = await buildDirFeatures(this.featureDeps, { symbol, t, horizon });
    
    // Get models
    const activeModel = await this.getActiveModel(horizon);
    const shadowModel = await this.getShadowModel(horizon);
    
    // Active prediction
    let active: ExchangeDirPrediction;
    if (activeModel) {
      const result = predictWithDirModel(activeModel, features);
      active = { label: result.label, proba: result.proba, confidence: result.confidence };
    } else {
      active = { label: 'NEUTRAL', proba: { UP: 0.33, DOWN: 0.33, NEUTRAL: 0.34 }, confidence: 0.34 };
    }
    
    // Shadow prediction
    let shadow: ExchangeDirPrediction | null = null;
    if (shadowModel) {
      const result = predictWithDirModel(shadowModel, features);
      shadow = { label: result.label, proba: result.proba, confidence: result.confidence };
    }
    
    return { active, shadow };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MODEL MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  async getActiveModel(horizon: Horizon): Promise<TrainedDirModel | null> {
    const cacheKey = `active_${horizon}`;
    const cached = this.modelCache.get(cacheKey);
    
    if (cached && Date.now() - cached.loadedAt < this.cacheTTL) {
      return cached.model;
    }
    
    // Get from registry
    const registry = await this.registryCollection.findOne({ horizon });
    if (!registry?.activeModelId) return null;
    
    const model = await this.modelsCollection.findOne({
      _id: new ObjectId(registry.activeModelId),
    });
    
    if (model) {
      const parsed = model as unknown as TrainedDirModel;
      this.modelCache.set(cacheKey, { model: parsed, loadedAt: Date.now() });
      return parsed;
    }
    
    return null;
  }
  
  async getShadowModel(horizon: Horizon): Promise<TrainedDirModel | null> {
    const registry = await this.registryCollection.findOne({ horizon });
    if (!registry?.shadowModelId) return null;
    
    const model = await this.modelsCollection.findOne({
      _id: new ObjectId(registry.shadowModelId),
    });
    
    return model as unknown as TrainedDirModel | null;
  }
  
  /**
   * Save a new model to the database.
   */
  async saveModel(model: TrainedDirModel): Promise<string> {
    const result = await this.modelsCollection.insertOne(model as any);
    console.log(`[DirInferenceService] Model saved: ${model.version}`);
    return result.insertedId.toString();
  }
  
  /**
   * Set active model for a horizon.
   */
  async setActiveModel(horizon: Horizon, modelId: string): Promise<void> {
    await this.registryCollection.updateOne(
      { horizon },
      {
        $set: {
          activeModelId: modelId,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    
    // Invalidate cache
    this.modelCache.delete(`active_${horizon}`);
    
    console.log(`[DirInferenceService] Active model set for ${horizon}: ${modelId}`);
  }
  
  /**
   * Set shadow model for a horizon.
   */
  async setShadowModel(horizon: Horizon, modelId: string): Promise<void> {
    await this.registryCollection.updateOne(
      { horizon },
      {
        $set: {
          shadowModelId: modelId,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    
    console.log(`[DirInferenceService] Shadow model set for ${horizon}: ${modelId}`);
  }
  
  /**
   * Promote shadow to active.
   */
  async promoteModel(horizon: Horizon): Promise<boolean> {
    const registry = await this.registryCollection.findOne({ horizon });
    if (!registry?.shadowModelId) return false;
    
    await this.registryCollection.updateOne(
      { horizon },
      {
        $set: {
          prevModelId: registry.activeModelId,
          activeModelId: registry.shadowModelId,
          shadowModelId: null,
          updatedAt: new Date(),
        },
      }
    );
    
    // Invalidate cache
    this.modelCache.delete(`active_${horizon}`);
    
    console.log(`[DirInferenceService] Model promoted for ${horizon}`);
    return true;
  }
  
  /**
   * Rollback to previous model.
   */
  async rollbackModel(horizon: Horizon): Promise<boolean> {
    const registry = await this.registryCollection.findOne({ horizon });
    if (!registry?.prevModelId) return false;
    
    await this.registryCollection.updateOne(
      { horizon },
      {
        $set: {
          activeModelId: registry.prevModelId,
          prevModelId: null,
          updatedAt: new Date(),
        },
      }
    );
    
    // Invalidate cache
    this.modelCache.delete(`active_${horizon}`);
    
    console.log(`[DirInferenceService] Model rolled back for ${horizon}`);
    return true;
  }
  
  /**
   * Get registry state.
   */
  async getRegistryState(horizon: Horizon): Promise<{
    activeModelId: string | null;
    shadowModelId: string | null;
    prevModelId: string | null;
  }> {
    const registry = await this.registryCollection.findOne({ horizon });
    
    return {
      activeModelId: registry?.activeModelId || null,
      shadowModelId: registry?.shadowModelId || null,
      prevModelId: registry?.prevModelId || null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let serviceInstance: DirInferenceService | null = null;

export function getDirInferenceService(
  db: Db,
  featureDeps: DirFeatureDeps
): DirInferenceService {
  if (!serviceInstance) {
    serviceInstance = new DirInferenceService(db, featureDeps);
  }
  return serviceInstance;
}

console.log('[Exchange ML] Direction inference service loaded');
