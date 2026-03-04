/**
 * P0: Model Config Store
 * 
 * MongoDB persistence layer for runtime engine configuration.
 * Enables Governance UI → Mongo → Engine chain.
 */

import { getDb } from '../../../db/mongodb.js';
import { ModelConfigDoc, AssetKey, DEFAULT_MODEL_CONFIG } from './model-config.contract.js';

const COLLECTION = 'model_config';

export class ModelConfigStore {
  /**
   * Get config for asset from MongoDB
   */
  static async get(asset: AssetKey): Promise<ModelConfigDoc | null> {
    try {
      const db = getDb();
      const doc = await db.collection<ModelConfigDoc>(COLLECTION).findOne(
        { asset },
        { projection: { _id: 0 } }
      );
      return doc;
    } catch (err) {
      console.error(`[ModelConfigStore] Error getting config for ${asset}:`, err);
      return null;
    }
  }

  /**
   * Upsert config for asset
   */
  static async upsert(
    asset: AssetKey, 
    patch: Partial<ModelConfigDoc>,
    updatedBy?: string
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const db = getDb();
      await db.collection<ModelConfigDoc>(COLLECTION).updateOne(
        { asset },
        {
          $set: {
            ...patch,
            asset,
            updatedAt: new Date(),
            updatedBy: updatedBy || 'system',
          },
        },
        { upsert: true }
      );
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[ModelConfigStore] Error upserting config for ${asset}:`, msg);
      return { ok: false, error: msg };
    }
  }

  /**
   * Initialize default config for asset if not exists
   */
  static async initializeIfMissing(asset: AssetKey): Promise<boolean> {
    const existing = await this.get(asset);
    if (existing) {
      return false; // Already exists
    }
    
    await this.upsert(asset, {
      ...DEFAULT_MODEL_CONFIG,
      version: 'v1.0.0-initial',
    }, 'system:init');
    
    console.log(`[ModelConfigStore] Initialized default config for ${asset}`);
    return true;
  }

  /**
   * List all configs
   */
  static async listAll(): Promise<ModelConfigDoc[]> {
    try {
      const db = getDb();
      return await db.collection<ModelConfigDoc>(COLLECTION)
        .find({}, { projection: { _id: 0 } })
        .toArray();
    } catch (err) {
      console.error('[ModelConfigStore] Error listing configs:', err);
      return [];
    }
  }
}
