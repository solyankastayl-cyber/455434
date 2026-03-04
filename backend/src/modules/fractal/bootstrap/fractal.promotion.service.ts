/**
 * BLOCK 29.7: Promotion Service
 * Handles promoting SHADOW models to ACTIVE and rollback logic
 */

import { FractalModelRegistryModel } from '../data/schemas/fractal-model-registry.schema.js';
import { FractalMLModel } from '../data/schemas/fractal-ml-model.schema.js';

export class FractalPromotionService {
  /**
   * Promote a SHADOW version to ACTIVE
   */
  async promote(symbol = 'BTC', version: string): Promise<{
    ok: boolean;
    promoted?: boolean;
    version?: string;
    reason?: string;
  }> {
    // 1) Find the shadow model
    const shadow = await FractalMLModel.findOne({ symbol, version }).lean();
    if (!shadow) {
      return { ok: false, reason: 'SHADOW_MODEL_NOT_FOUND' };
    }

    // 2) Copy shadow to ACTIVE slot
    await FractalMLModel.updateOne(
      { symbol, version: 'ACTIVE' },
      {
        $set: {
          symbol,
          version: 'ACTIVE',
          type: shadow.type,
          weights: shadow.weights,
          bias: shadow.bias,
          featureOrder: shadow.featureOrder,
          trainStats: shadow.trainStats,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    // 3) Update registry statuses
    // Archive any existing ACTIVE
    await FractalModelRegistryModel.updateMany(
      { symbol, status: 'ACTIVE' },
      { $set: { status: 'ARCHIVED' } }
    );

    // Set new version as ACTIVE
    await FractalModelRegistryModel.updateOne(
      { symbol, version },
      { $set: { status: 'ACTIVE' } }
    );

    console.log(`[Promotion] Model ${version} promoted to ACTIVE for ${symbol}`);

    return { ok: true, promoted: true, version };
  }

  /**
   * Rollback to the most recent ARCHIVED version
   */
  async rollback(symbol = 'BTC'): Promise<{
    ok: boolean;
    rolledBackTo?: string;
    reason?: string;
  }> {
    // Find most recent archived model
    const last = await FractalModelRegistryModel
      .findOne({ symbol, status: 'ARCHIVED' })
      .sort({ createdAt: -1 })
      .lean();

    if (!last) {
      return { ok: false, reason: 'NO_ARCHIVED_MODEL' };
    }

    // Get the archived model weights
    const model = await FractalMLModel.findOne({ symbol, version: last.version }).lean();
    if (!model) {
      return { ok: false, reason: 'ARCHIVED_MODEL_WEIGHTS_MISSING' };
    }

    // Copy archived to ACTIVE slot
    await FractalMLModel.updateOne(
      { symbol, version: 'ACTIVE' },
      {
        $set: {
          symbol,
          version: 'ACTIVE',
          type: model.type,
          weights: model.weights,
          bias: model.bias,
          featureOrder: model.featureOrder,
          trainStats: model.trainStats,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    // Update registry: archive current ACTIVE, activate the rollback version
    await FractalModelRegistryModel.updateMany(
      { symbol, status: 'ACTIVE' },
      { $set: { status: 'ARCHIVED' } }
    );

    await FractalModelRegistryModel.updateOne(
      { symbol, version: last.version },
      { $set: { status: 'ACTIVE' } }
    );

    console.log(`[Promotion] Rolled back to ${last.version} for ${symbol}`);

    return { ok: true, rolledBackTo: last.version };
  }

  /**
   * Get current ACTIVE model info
   */
  async getActiveModel(symbol = 'BTC') {
    const active = await FractalModelRegistryModel
      .findOne({ symbol, status: 'ACTIVE' })
      .lean();

    return active;
  }

  /**
   * Get model history
   */
  async getHistory(symbol = 'BTC', limit = 20) {
    const history = await FractalModelRegistryModel
      .find({ symbol })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return history.map(h => ({
      version: h.version,
      status: h.status,
      type: h.type,
      metrics: h.metrics,
      createdAt: h.createdAt
    }));
  }
}
