/**
 * Exchange Auto-Learning Loop - PR2: Model Registry Service
 * 
 * Manages the lifecycle of ML models:
 * - Active model pointer per horizon
 * - Shadow model for evaluation
 * - Previous model for rollback
 * - Version tracking and history
 */

import { Db, Collection, ObjectId } from 'mongodb';
import {
  ExchangeModel,
  ExchangeModelRegistry,
  ModelStatus,
} from './exchange_training.types.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';
import { getExchangeModelLoader } from './exchange_model_loader.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const REGISTRY_COLLECTION = 'exch_model_registry';
const MODELS_COLLECTION = 'exch_models';

// ═══════════════════════════════════════════════════════════════
// MODEL REGISTRY SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeModelRegistryService {
  private registryCollection: Collection<ExchangeModelRegistry>;
  private modelsCollection: Collection<ExchangeModel>;
  
  constructor(private db: Db) {
    this.registryCollection = db.collection<ExchangeModelRegistry>(REGISTRY_COLLECTION);
    this.modelsCollection = db.collection<ExchangeModel>(MODELS_COLLECTION);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    await this.registryCollection.createIndex(
      { horizon: 1 },
      { unique: true, name: 'idx_registry_horizon' }
    );
    
    console.log('[ModelRegistryService] Indexes ensured');
  }
  
  /**
   * Initialize registry for all horizons if not exists.
   */
  async initializeRegistries(): Promise<void> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    const now = new Date();
    
    for (const horizon of horizons) {
      await this.registryCollection.updateOne(
        { horizon },
        {
          $setOnInsert: {
            horizon,
            activeModelId: null,
            activeModelVersion: 0,
            shadowModelId: null,
            prevModelId: null,
            prevModelVersion: null,
            lastPromotionAt: null,
            lastRollbackAt: null,
            lastRetrainAt: null,
            totalVersions: 0,
            totalPromotions: 0,
            totalRollbacks: 0,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
    }
    
    console.log('[ModelRegistryService] Registries initialized');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // REGISTRY QUERIES
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get registry for a horizon.
   */
  async getRegistry(horizon: ExchangeHorizon): Promise<ExchangeModelRegistry | null> {
    return this.registryCollection.findOne({ horizon }) as Promise<ExchangeModelRegistry | null>;
  }
  
  /**
   * Get all registries.
   */
  async getAllRegistries(): Promise<ExchangeModelRegistry[]> {
    return this.registryCollection.find({}).toArray() as Promise<ExchangeModelRegistry[]>;
  }
  
  /**
   * Get active model ID for a horizon.
   */
  async getActiveModelId(horizon: ExchangeHorizon): Promise<string | null> {
    const registry = await this.getRegistry(horizon);
    return registry?.activeModelId || null;
  }
  
  /**
   * Get active model for a horizon.
   */
  async getActiveModel(horizon: ExchangeHorizon): Promise<ExchangeModel | null> {
    const registry = await this.getRegistry(horizon);
    if (!registry?.activeModelId) {
      return null;
    }
    return this.modelsCollection.findOne({ modelId: registry.activeModelId }) as Promise<ExchangeModel | null>;
  }
  
  /**
   * Get shadow model for a horizon.
   */
  async getShadowModel(horizon: ExchangeHorizon): Promise<ExchangeModel | null> {
    const registry = await this.getRegistry(horizon);
    if (!registry?.shadowModelId) {
      return null;
    }
    return this.modelsCollection.findOne({ modelId: registry.shadowModelId }) as Promise<ExchangeModel | null>;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MODEL LIFECYCLE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Register a new model as shadow (candidate for promotion).
   */
  async registerShadowModel(modelId: string, horizon: ExchangeHorizon): Promise<{ success: boolean; error?: string }> {
    const now = new Date();
    
    // Verify model exists
    const model = await this.modelsCollection.findOne({ modelId });
    if (!model) {
      return { success: false, error: 'Model not found' };
    }
    
    // Get current registry
    const registry = await this.getRegistry(horizon);
    if (!registry) {
      await this.initializeRegistries();
    }
    
    // If there's an existing shadow, retire it
    const currentShadowId = registry?.shadowModelId;
    if (currentShadowId) {
      await this.modelsCollection.updateOne(
        { modelId: currentShadowId },
        { $set: { status: 'RETIRED' as ModelStatus, retiredAt: now, updatedAt: now } }
      );
    }
    
    // Set new model as shadow
    await this.modelsCollection.updateOne(
      { modelId },
      { $set: { status: 'SHADOW' as ModelStatus, updatedAt: now } }
    );
    
    // Update registry
    await this.registryCollection.updateOne(
      { horizon },
      {
        $set: {
          shadowModelId: modelId,
          lastRetrainAt: now,
          updatedAt: now,
        },
        $inc: { totalVersions: 1 },
      },
      { upsert: true }
    );
    
    console.log(`[Registry] Shadow model registered: ${modelId} for ${horizon}`);
    
    return { success: true };
  }
  
  /**
   * Promote shadow model to active.
   */
  async promoteShadowToActive(horizon: ExchangeHorizon): Promise<{ success: boolean; promotedModelId?: string; error?: string }> {
    const now = new Date();
    const registry = await this.getRegistry(horizon);
    
    if (!registry?.shadowModelId) {
      return { success: false, error: 'No shadow model to promote' };
    }
    
    const shadowModel = await this.modelsCollection.findOne({ modelId: registry.shadowModelId });
    if (!shadowModel) {
      return { success: false, error: 'Shadow model not found in DB' };
    }
    
    // Move current active to previous
    const currentActiveId = registry.activeModelId;
    const currentActiveVersion = registry.activeModelVersion;
    
    if (currentActiveId) {
      // Mark old active as retired
      await this.modelsCollection.updateOne(
        { modelId: currentActiveId },
        { $set: { status: 'RETIRED' as ModelStatus, retiredAt: now, updatedAt: now } }
      );
    }
    
    // Promote shadow to active
    await this.modelsCollection.updateOne(
      { modelId: registry.shadowModelId },
      { $set: { status: 'ACTIVE' as ModelStatus, promotedAt: now, updatedAt: now } }
    );
    
    // Update registry
    await this.registryCollection.updateOne(
      { horizon },
      {
        $set: {
          activeModelId: registry.shadowModelId,
          activeModelVersion: shadowModel.version,
          prevModelId: currentActiveId,
          prevModelVersion: currentActiveVersion,
          shadowModelId: null,
          lastPromotionAt: now,
          updatedAt: now,
        },
        $inc: { totalPromotions: 1 },
      }
    );
    
    console.log(`[Registry] Model promoted: ${registry.shadowModelId} -> ACTIVE for ${horizon}`);
    
    // BLOCK 2.7: Invalidate model cache to ensure next inference uses new model
    const loader = getExchangeModelLoader(this.db);
    loader.invalidateCache();
    
    return { success: true, promotedModelId: registry.shadowModelId };
  }
  
  /**
   * Rollback to previous model.
   */
  async rollbackToPrevious(horizon: ExchangeHorizon): Promise<{ success: boolean; rolledBackTo?: string; error?: string }> {
    const now = new Date();
    const registry = await this.getRegistry(horizon);
    
    if (!registry?.prevModelId) {
      return { success: false, error: 'No previous model to rollback to' };
    }
    
    const prevModel = await this.modelsCollection.findOne({ modelId: registry.prevModelId });
    if (!prevModel) {
      return { success: false, error: 'Previous model not found in DB' };
    }
    
    // Mark current active as retired
    if (registry.activeModelId) {
      await this.modelsCollection.updateOne(
        { modelId: registry.activeModelId },
        { $set: { status: 'RETIRED' as ModelStatus, retiredAt: now, updatedAt: now } }
      );
    }
    
    // Restore previous model to active
    await this.modelsCollection.updateOne(
      { modelId: registry.prevModelId },
      { $set: { status: 'ACTIVE' as ModelStatus, updatedAt: now } }
    );
    
    // Update registry
    await this.registryCollection.updateOne(
      { horizon },
      {
        $set: {
          activeModelId: registry.prevModelId,
          activeModelVersion: registry.prevModelVersion,
          prevModelId: null,
          prevModelVersion: null,
          lastRollbackAt: now,
          updatedAt: now,
        },
        $inc: { totalRollbacks: 1 },
      }
    );
    
    console.log(`[Registry] Rolled back to: ${registry.prevModelId} for ${horizon}`);
    
    // BLOCK 2.7: Invalidate model cache to ensure next inference uses rolled-back model
    const loader = getExchangeModelLoader(this.db);
    loader.invalidateCache();
    
    return { success: true, rolledBackTo: registry.prevModelId };
  }
  
  /**
   * Manually set active model (for initial setup or recovery).
   */
  async setActiveModel(modelId: string, horizon: ExchangeHorizon): Promise<{ success: boolean; error?: string }> {
    const now = new Date();
    
    const model = await this.modelsCollection.findOne({ modelId });
    if (!model) {
      return { success: false, error: 'Model not found' };
    }
    
    const registry = await this.getRegistry(horizon);
    const currentActiveId = registry?.activeModelId;
    
    // Retire current active if exists
    if (currentActiveId && currentActiveId !== modelId) {
      await this.modelsCollection.updateOne(
        { modelId: currentActiveId },
        { $set: { status: 'RETIRED' as ModelStatus, retiredAt: now, updatedAt: now } }
      );
    }
    
    // Set new model as active
    await this.modelsCollection.updateOne(
      { modelId },
      { $set: { status: 'ACTIVE' as ModelStatus, promotedAt: now, updatedAt: now } }
    );
    
    // Update registry
    await this.registryCollection.updateOne(
      { horizon },
      {
        $set: {
          activeModelId: modelId,
          activeModelVersion: model.version,
          prevModelId: currentActiveId || null,
          prevModelVersion: registry?.activeModelVersion || null,
          lastPromotionAt: now,
          updatedAt: now,
        },
        $inc: { totalPromotions: 1 },
      },
      { upsert: true }
    );
    
    console.log(`[Registry] Active model set manually: ${modelId} for ${horizon}`);
    
    return { success: true };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════
  
  async getStats(): Promise<{
    registries: ExchangeModelRegistry[];
    summary: {
      horizonsWithActiveModel: number;
      horizonsWithShadow: number;
      totalPromotions: number;
      totalRollbacks: number;
    };
  }> {
    const registries = await this.getAllRegistries();
    
    const summary = {
      horizonsWithActiveModel: registries.filter(r => r.activeModelId).length,
      horizonsWithShadow: registries.filter(r => r.shadowModelId).length,
      totalPromotions: registries.reduce((sum, r) => sum + r.totalPromotions, 0),
      totalRollbacks: registries.reduce((sum, r) => sum + r.totalRollbacks, 0),
    };
    
    return { registries, summary };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let registryInstance: ExchangeModelRegistryService | null = null;

export function getExchangeModelRegistryService(db: Db): ExchangeModelRegistryService {
  if (!registryInstance) {
    registryInstance = new ExchangeModelRegistryService(db);
  }
  return registryInstance;
}

console.log('[Exchange ML] Model registry service loaded');
