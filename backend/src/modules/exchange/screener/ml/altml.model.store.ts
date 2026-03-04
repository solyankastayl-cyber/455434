/**
 * BLOCK 1.5.4 — Alt ML Model Store
 * ==================================
 * MongoDB persistence for trained models.
 */

import type { Collection, Db } from 'mongodb';
import type { AltMlModel } from './altml.types.js';

export class AltMlModelStore {
  private col: Collection<AltMlModel>;

  constructor(db: Db) {
    this.col = db.collection<AltMlModel>('screener_ml_models');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    try {
      await this.col.createIndex({ horizon: 1, trainedAt: -1 });
      await this.col.createIndex({ version: 1 }, { unique: true });
    } catch (e) {
      console.warn('[AltMlModelStore] Index creation failed:', e);
    }
  }

  /**
   * Save a trained model
   */
  async save(model: AltMlModel): Promise<void> {
    await this.col.insertOne(model);
    console.log(`[AltMlModelStore] Saved model: ${model.version}`);
  }

  /**
   * Get latest model for horizon
   */
  async latest(horizon: '1h' | '4h' | '24h'): Promise<AltMlModel | null> {
    return this.col
      .find({ horizon })
      .sort({ trainedAt: -1 })
      .limit(1)
      .next();
  }

  /**
   * Get model by version
   */
  async getByVersion(version: string): Promise<AltMlModel | null> {
    return this.col.findOne({ version });
  }

  /**
   * List all models
   */
  async listModels(limit = 20): Promise<AltMlModel[]> {
    return this.col
      .find({}, { projection: { weights: 0 } }) // Exclude heavy weights
      .sort({ trainedAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Delete old models (keep latest N per horizon)
   */
  async cleanup(keepPerHorizon = 5): Promise<number> {
    let deleted = 0;

    for (const horizon of ['1h', '4h', '24h'] as const) {
      const models = await this.col
        .find({ horizon })
        .sort({ trainedAt: -1 })
        .skip(keepPerHorizon)
        .project({ version: 1 })
        .toArray();

      if (models.length > 0) {
        const versions = models.map(m => m.version);
        const result = await this.col.deleteMany({ version: { $in: versions } });
        deleted += result.deletedCount;
      }
    }

    return deleted;
  }
}

console.log('[Screener ML] Model Store loaded');
