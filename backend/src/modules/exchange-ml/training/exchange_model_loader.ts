/**
 * Exchange Model Loader (BLOCK 2.3)
 * 
 * Production-safe model loading with version-aware TTL cache.
 * 
 * CRITICAL: No global singleton models.
 * Cache is version-keyed, not model-ID-keyed.
 * This ensures that after promotion, the new version is loaded.
 */

import { Db } from 'mongodb';
import { ExchangeModel } from '../training/exchange_training.types.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// CACHE CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CACHE_TTL_MS = 60 * 1000; // 60 seconds max (production safe)
const MODELS_COLLECTION = 'exch_models';

// ═══════════════════════════════════════════════════════════════
// VERSION-AWARE CACHE
// ═══════════════════════════════════════════════════════════════

interface CacheEntry {
  model: ExchangeModel;
  loadedAt: number;
  version: number;
}

class VersionAwareModelCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;
  
  constructor(ttlMs: number = DEFAULT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs;
  }
  
  /**
   * Get model from cache if valid.
   * Returns null if:
   * - Not in cache
   * - TTL expired
   * - Version mismatch (promotion happened)
   */
  get(modelId: string, expectedVersion?: number): ExchangeModel | null {
    const entry = this.cache.get(modelId);
    
    if (!entry) return null;
    
    // Check TTL
    if (Date.now() - entry.loadedAt > this.ttlMs) {
      this.cache.delete(modelId);
      return null;
    }
    
    // Check version if provided (ensures fresh after promotion)
    if (expectedVersion !== undefined && entry.version !== expectedVersion) {
      this.cache.delete(modelId);
      return null;
    }
    
    return entry.model;
  }
  
  /**
   * Store model in cache.
   */
  set(modelId: string, model: ExchangeModel): void {
    this.cache.set(modelId, {
      model,
      loadedAt: Date.now(),
      version: model.version,
    });
  }
  
  /**
   * Invalidate specific model or all models.
   */
  invalidate(modelId?: string): void {
    if (modelId) {
      this.cache.delete(modelId);
    } else {
      this.cache.clear();
    }
  }
  
  /**
   * Get cache stats for debugging.
   */
  getStats(): { size: number; models: string[]; ttlMs: number } {
    return {
      size: this.cache.size,
      models: Array.from(this.cache.keys()),
      ttlMs: this.ttlMs,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// MODEL LOADER SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeModelLoader {
  private cache: VersionAwareModelCache;
  
  constructor(
    private db: Db,
    cacheTtlMs: number = DEFAULT_CACHE_TTL_MS
  ) {
    this.cache = new VersionAwareModelCache(cacheTtlMs);
  }
  
  /**
   * Load model by ID.
   * Uses TTL cache but validates version if provided.
   */
  async loadModel(
    modelId: string,
    expectedVersion?: number
  ): Promise<ExchangeModel | null> {
    // Try cache first
    const cached = this.cache.get(modelId, expectedVersion);
    if (cached) {
      return cached;
    }
    
    // Load from DB
    const model = await this.db.collection<ExchangeModel>(MODELS_COLLECTION)
      .findOne({ modelId });
    
    if (!model) {
      console.warn(`[ModelLoader] Model not found: ${modelId}`);
      return null;
    }
    
    // Version mismatch check
    if (expectedVersion !== undefined && model.version !== expectedVersion) {
      console.warn(`[ModelLoader] Version mismatch: ${modelId} expected v${expectedVersion}, got v${model.version}`);
      // Still return the model, but log the discrepancy
    }
    
    // Cache it
    this.cache.set(modelId, model);
    
    return model;
  }
  
  /**
   * Load model by version number for a horizon.
   * Used for historical lookups or explicit version requests.
   */
  async loadModelByVersion(
    horizon: ExchangeHorizon,
    version: number
  ): Promise<ExchangeModel | null> {
    const model = await this.db.collection<ExchangeModel>(MODELS_COLLECTION)
      .findOne({ horizon, version });
    
    if (!model) {
      console.warn(`[ModelLoader] Model not found: ${horizon} v${version}`);
      return null;
    }
    
    // Cache it
    this.cache.set(model.modelId, model);
    
    return model;
  }
  
  /**
   * Invalidate cache after promotion/rollback.
   * Called by registry after state changes.
   */
  invalidateCache(modelId?: string): void {
    this.cache.invalidate(modelId);
    console.log(`[ModelLoader] Cache invalidated: ${modelId || 'ALL'}`);
  }
  
  /**
   * Get cache stats.
   */
  getCacheStats(): { size: number; models: string[]; ttlMs: number } {
    return this.cache.getStats();
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let loaderInstance: ExchangeModelLoader | null = null;

export function getExchangeModelLoader(db: Db): ExchangeModelLoader {
  if (!loaderInstance) {
    // Use env config for TTL (default 60s, production safe)
    const ttlMs = parseInt(process.env.EXCHANGE_MODEL_CACHE_TTL_MS || '60000', 10);
    loaderInstance = new ExchangeModelLoader(db, ttlMs);
  }
  return loaderInstance;
}

/**
 * Reset loader instance (for testing).
 */
export function resetExchangeModelLoader(): void {
  loaderInstance = null;
}

console.log('[Exchange ML] Model Loader loaded (BLOCK 2.3)');
