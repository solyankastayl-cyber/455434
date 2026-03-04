/**
 * Fractal Model Registry Service
 * 
 * Manages the lifecycle of Fractal pattern matching models:
 * - Active model pointer per horizon
 * - Shadow model for evaluation
 * - Previous model for rollback
 * - Version tracking and history
 * 
 * Adapted from Exchange module for Fractal-specific requirements.
 */

import { Db, Collection, ObjectId } from 'mongodb';
import { FractalHorizon } from './fractal_lifecycle.config.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const REGISTRY_COLLECTION = 'fractal_model_registry';
const MODELS_COLLECTION = 'fractal_models';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type FractalModelStatus = 'READY' | 'SHADOW' | 'ACTIVE' | 'RETIRED' | 'FROZEN';

export interface FractalModelArtifact {
  type: 'PATTERN_MATCHER' | 'SIMILARITY_ENGINE' | 'HYBRID';
  weightsPath?: string;
  similarityThresholds: {
    highMatch: number;    // 0.75+
    mediumMatch: number;  // 0.60+
    lowMatch: number;     // 0.45+
  };
  phaseWeights: Record<string, number>;
  horizonWeights: Record<FractalHorizon, number>;
  normalization: Record<string, { mean: number; std: number }>;
}

export interface FractalModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  patternMatchRate: number;
  expectedMatchRate: number;
  brierScore: number;
  effectiveSampleSize: number;
  calibrationECE: number;
}

export interface FractalModel {
  modelId: string;
  horizon: FractalHorizon;
  version: number;
  status: FractalModelStatus;
  trainingRunId?: string;
  trainedAt: Date;
  datasetInfo: {
    totalSamples: number;
    trainSize: number;
    validSize: number;
    testSize: number;
    dateRange: { from: Date; to: Date };
  };
  metrics: FractalModelMetrics;
  artifact: FractalModelArtifact;
  createdAt: Date;
  updatedAt: Date;
  promotedAt: Date | null;
  retiredAt: Date | null;
}

export interface FractalModelRegistry {
  _id?: ObjectId;
  horizon: FractalHorizon;
  activeModelId: string | null;
  activeModelVersion: number;
  shadowModelId: string | null;
  prevModelId: string | null;
  prevModelVersion: number | null;
  lastPromotionAt: Date | null;
  lastRollbackAt: Date | null;
  lastRetrainAt: Date | null;
  totalVersions: number;
  totalPromotions: number;
  totalRollbacks: number;
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// MODEL REGISTRY SERVICE
// ═══════════════════════════════════════════════════════════════

export class FractalModelRegistryService {
  private registryCollection: Collection<FractalModelRegistry>;
  private modelsCollection: Collection<FractalModel>;
  
  constructor(private db: Db) {
    this.registryCollection = db.collection<FractalModelRegistry>(REGISTRY_COLLECTION);
    this.modelsCollection = db.collection<FractalModel>(MODELS_COLLECTION);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    await this.registryCollection.createIndex(
      { horizon: 1 },
      { unique: true, name: 'idx_fractal_registry_horizon' }
    );
    
    await this.modelsCollection.createIndex(
      { modelId: 1 },
      { unique: true, name: 'idx_fractal_model_id' }
    );
    
    await this.modelsCollection.createIndex(
      { horizon: 1, version: -1 },
      { name: 'idx_fractal_horizon_version' }
    );
    
    await this.modelsCollection.createIndex(
      { horizon: 1, status: 1 },
      { name: 'idx_fractal_horizon_status' }
    );
    
    console.log('[FractalModelRegistryService] Indexes ensured');
  }
  
  async initializeRegistries(): Promise<void> {
    const horizons: FractalHorizon[] = ['7D', '14D', '30D', '60D'];
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
    
    console.log('[FractalModelRegistryService] Registries initialized');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // REGISTRY QUERIES
  // ═══════════════════════════════════════════════════════════════
  
  async getRegistry(horizon: FractalHorizon): Promise<FractalModelRegistry | null> {
    return this.registryCollection.findOne({ horizon }) as Promise<FractalModelRegistry | null>;
  }
  
  async getAllRegistries(): Promise<FractalModelRegistry[]> {
    return this.registryCollection.find({}).toArray() as Promise<FractalModelRegistry[]>;
  }
  
  async getActiveModelId(horizon: FractalHorizon): Promise<string | null> {
    const registry = await this.getRegistry(horizon);
    return registry?.activeModelId || null;
  }
  
  async getActiveModel(horizon: FractalHorizon): Promise<FractalModel | null> {
    const registry = await this.getRegistry(horizon);
    if (!registry?.activeModelId) {
      return null;
    }
    return this.modelsCollection.findOne({ modelId: registry.activeModelId }) as Promise<FractalModel | null>;
  }
  
  async getShadowModel(horizon: FractalHorizon): Promise<FractalModel | null> {
    const registry = await this.getRegistry(horizon);
    if (!registry?.shadowModelId) {
      return null;
    }
    return this.modelsCollection.findOne({ modelId: registry.shadowModelId }) as Promise<FractalModel | null>;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MODEL LIFECYCLE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  async registerShadowModel(modelId: string, horizon: FractalHorizon): Promise<{ success: boolean; error?: string }> {
    const now = new Date();
    
    const model = await this.modelsCollection.findOne({ modelId });
    if (!model) {
      return { success: false, error: 'Model not found' };
    }
    
    const registry = await this.getRegistry(horizon);
    if (!registry) {
      await this.initializeRegistries();
    }
    
    // Retire existing shadow
    const currentShadowId = registry?.shadowModelId;
    if (currentShadowId) {
      await this.modelsCollection.updateOne(
        { modelId: currentShadowId },
        { $set: { status: 'RETIRED' as FractalModelStatus, retiredAt: now, updatedAt: now } }
      );
    }
    
    // Set new shadow
    await this.modelsCollection.updateOne(
      { modelId },
      { $set: { status: 'SHADOW' as FractalModelStatus, updatedAt: now } }
    );
    
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
    
    console.log(`[FractalRegistry] Shadow model registered: ${modelId} for ${horizon}`);
    
    return { success: true };
  }
  
  async promoteShadowToActive(horizon: FractalHorizon): Promise<{ success: boolean; promotedModelId?: string; error?: string }> {
    const now = new Date();
    const registry = await this.getRegistry(horizon);
    
    if (!registry?.shadowModelId) {
      return { success: false, error: 'No shadow model to promote' };
    }
    
    const shadowModel = await this.modelsCollection.findOne({ modelId: registry.shadowModelId });
    if (!shadowModel) {
      return { success: false, error: 'Shadow model not found in DB' };
    }
    
    const currentActiveId = registry.activeModelId;
    const currentActiveVersion = registry.activeModelVersion;
    
    // Retire current active
    if (currentActiveId) {
      await this.modelsCollection.updateOne(
        { modelId: currentActiveId },
        { $set: { status: 'RETIRED' as FractalModelStatus, retiredAt: now, updatedAt: now } }
      );
    }
    
    // Promote shadow
    await this.modelsCollection.updateOne(
      { modelId: registry.shadowModelId },
      { $set: { status: 'ACTIVE' as FractalModelStatus, promotedAt: now, updatedAt: now } }
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
    
    console.log(`[FractalRegistry] Model promoted: ${registry.shadowModelId} -> ACTIVE for ${horizon}`);
    
    return { success: true, promotedModelId: registry.shadowModelId };
  }
  
  async rollbackToPrevious(horizon: FractalHorizon): Promise<{ success: boolean; rolledBackTo?: string; error?: string }> {
    const now = new Date();
    const registry = await this.getRegistry(horizon);
    
    if (!registry?.prevModelId) {
      return { success: false, error: 'No previous model to rollback to' };
    }
    
    const prevModel = await this.modelsCollection.findOne({ modelId: registry.prevModelId });
    if (!prevModel) {
      return { success: false, error: 'Previous model not found in DB' };
    }
    
    // Retire current active
    if (registry.activeModelId) {
      await this.modelsCollection.updateOne(
        { modelId: registry.activeModelId },
        { $set: { status: 'RETIRED' as FractalModelStatus, retiredAt: now, updatedAt: now } }
      );
    }
    
    // Restore previous
    await this.modelsCollection.updateOne(
      { modelId: registry.prevModelId },
      { $set: { status: 'ACTIVE' as FractalModelStatus, updatedAt: now } }
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
    
    console.log(`[FractalRegistry] Rolled back to: ${registry.prevModelId} for ${horizon}`);
    
    return { success: true, rolledBackTo: registry.prevModelId };
  }
  
  async setActiveModel(modelId: string, horizon: FractalHorizon): Promise<{ success: boolean; error?: string }> {
    const now = new Date();
    
    const model = await this.modelsCollection.findOne({ modelId });
    if (!model) {
      return { success: false, error: 'Model not found' };
    }
    
    const registry = await this.getRegistry(horizon);
    const currentActiveId = registry?.activeModelId;
    
    if (currentActiveId && currentActiveId !== modelId) {
      await this.modelsCollection.updateOne(
        { modelId: currentActiveId },
        { $set: { status: 'RETIRED' as FractalModelStatus, retiredAt: now, updatedAt: now } }
      );
    }
    
    await this.modelsCollection.updateOne(
      { modelId },
      { $set: { status: 'ACTIVE' as FractalModelStatus, promotedAt: now, updatedAt: now } }
    );
    
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
    
    console.log(`[FractalRegistry] Active model set manually: ${modelId} for ${horizon}`);
    
    return { success: true };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MODEL PERSISTENCE
  // ═══════════════════════════════════════════════════════════════
  
  async saveModel(model: Omit<FractalModel, '_id'>): Promise<string> {
    await this.modelsCollection.insertOne(model as any);
    console.log(`[FractalRegistry] Model saved: ${model.modelId} (v${model.version})`);
    return model.modelId;
  }
  
  async getModel(modelId: string): Promise<FractalModel | null> {
    return this.modelsCollection.findOne({ modelId }) as Promise<FractalModel | null>;
  }
  
  async getLatestModel(horizon: FractalHorizon): Promise<FractalModel | null> {
    const models = await this.modelsCollection
      .find({ horizon, status: { $in: ['READY', 'ACTIVE', 'SHADOW'] } })
      .sort({ version: -1 })
      .limit(1)
      .toArray();
    
    return models[0] as FractalModel || null;
  }
  
  async getModelsByHorizon(horizon: FractalHorizon): Promise<FractalModel[]> {
    return this.modelsCollection
      .find({ horizon })
      .sort({ version: -1 })
      .toArray() as Promise<FractalModel[]>;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════
  
  async getStats(): Promise<{
    registries: FractalModelRegistry[];
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

let registryInstance: FractalModelRegistryService | null = null;

export function getFractalModelRegistryService(db: Db): FractalModelRegistryService {
  if (!registryInstance) {
    registryInstance = new FractalModelRegistryService(db);
  }
  return registryInstance;
}

export function resetFractalModelRegistryService(): void {
  registryInstance = null;
}

console.log('[Fractal ML] Model registry service loaded');
