/**
 * Direction Dataset Service
 * =========================
 * 
 * Manages training samples for Direction Model.
 * Similar to Environment dataset but with direction-specific labeling.
 */

import { Db, Collection, ObjectId } from 'mongodb';
import { DirLabel, Horizon, DirSample, DirFeatureSnapshot, SampleStatus } from '../contracts/exchange.types.js';
import { labelDirection } from './dir.labeler.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_NAME = 'exch_dir_samples';
const FEATURE_VERSION = 'dir_v1.0.0';

const HORIZON_MS: Record<Horizon, number> = {
  '1D': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '30D': 30 * 24 * 60 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════════════
// SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export class DirDatasetService {
  private collection: Collection<DirSample>;

  constructor(private db: Db) {
    this.collection = db.collection<DirSample>(COLLECTION_NAME);
  }

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { symbol: 1, horizon: 1, t0: 1 },
      { unique: true, name: 'idx_unique_dir_sample' }
    );

    await this.collection.createIndex(
      { status: 1, resolveAt: 1 },
      { name: 'idx_pending_resolution' }
    );

    await this.collection.createIndex(
      { horizon: 1, status: 1 },
      { name: 'idx_horizon_status' }
    );

    await this.collection.createIndex(
      { createdAt: -1 },
      { name: 'idx_created_at' }
    );

    console.log('[DirDatasetService] Indexes ensured');
  }

  // ═══════════════════════════════════════════════════════════════
  // CREATE SAMPLE
  // ═══════════════════════════════════════════════════════════════

  async createSample(params: {
    symbol: string;
    horizon: Horizon;
    t0: Date;
    features: DirFeatureSnapshot;
    entryPrice: number;
  }): Promise<{ id: string; created: boolean }> {
    const { symbol, horizon, t0, features, entryPrice } = params;

    const now = new Date();
    const resolveAt = new Date(t0.getTime() + HORIZON_MS[horizon]);

    if (t0 > now) {
      throw new Error(`Invalid t0: cannot be in the future`);
    }

    if (entryPrice <= 0) {
      throw new Error(`Invalid entryPrice: must be positive`);
    }

    const sample: DirSample = {
      symbol: symbol.toUpperCase(),
      horizon,
      t0,
      features,
      featureVersion: FEATURE_VERSION,
      entryPrice,
      label: null,
      status: 'PENDING',
      resolveAt,
      resolvedAt: null,
      exitPrice: null,
      returnPct: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const result = await this.collection.insertOne(sample as any);
      console.log(`[DirDatasetService] Sample created: ${symbol}/${horizon} at ${t0.toISOString()}`);
      return { id: result.insertedId.toString(), created: true };
    } catch (err: any) {
      if (err.code === 11000) {
        const existing = await this.collection.findOne({
          symbol: symbol.toUpperCase(),
          horizon,
          t0,
        });
        return { id: existing?._id?.toString() || '', created: false };
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RESOLVE SAMPLE
  // ═══════════════════════════════════════════════════════════════

  async resolveSample(params: {
    sampleId: string;
    exitPrice: number;
  }): Promise<{ success: boolean; label?: DirLabel }> {
    const sample = await this.collection.findOne({
      _id: new ObjectId(params.sampleId) as any,
    });

    if (!sample) {
      return { success: false };
    }

    const returnPct = (params.exitPrice - sample.entryPrice) / sample.entryPrice;

    // Use horizon-adjusted labeling
    const label = labelDirection({
      horizon: sample.horizon,
      realizedReturn: returnPct,
    });

    const result = await this.collection.updateOne(
      { _id: new ObjectId(params.sampleId) as any },
      {
        $set: {
          exitPrice: params.exitPrice,
          returnPct,
          label,
          status: 'RESOLVED' as SampleStatus,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `[DirDatasetService] Sample resolved: ${sample.symbol}/${sample.horizon} ` +
        `return=${(returnPct * 100).toFixed(2)}% -> ${label}`
      );
    }

    return { success: result.modifiedCount > 0, label };
  }

  // ═══════════════════════════════════════════════════════════════
  // QUERY SAMPLES
  // ═══════════════════════════════════════════════════════════════

  async getSamplesReadyForResolution(limit: number = 50): Promise<DirSample[]> {
    const now = new Date();

    return this.collection
      .find({
        status: 'PENDING',
        resolveAt: { $lte: now },
      })
      .sort({ resolveAt: 1 })
      .limit(limit)
      .toArray() as Promise<DirSample[]>;
  }

  async getResolvedSamples(params: {
    horizon?: Horizon;
    minDate?: Date;
    maxDate?: Date;
    limit?: number;
  }): Promise<DirSample[]> {
    const { horizon, minDate, maxDate, limit = 1000 } = params;

    const query: any = {
      status: 'RESOLVED',
      label: { $ne: null },
    };

    if (horizon) {
      query.horizon = horizon;
    }

    if (minDate || maxDate) {
      query.t0 = {};
      if (minDate) query.t0.$gte = minDate;
      if (maxDate) query.t0.$lte = maxDate;
    }

    return this.collection
      .find(query)
      .sort({ t0: -1 })
      .limit(limit)
      .toArray() as Promise<DirSample[]>;
  }

  async getSampleById(id: string): Promise<DirSample | null> {
    try {
      return await this.collection.findOne({ _id: new ObjectId(id) as any }) as DirSample | null;
    } catch {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════

  async getStats(): Promise<{
    total: number;
    byStatus: Record<SampleStatus, number>;
    byHorizon: Record<Horizon, number>;
    byLabel: Record<DirLabel | 'PENDING', number>;
    accuracy: number;
  }> {
    const pipeline = [
      {
        $facet: {
          total: [{ $count: 'count' }],
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          byHorizon: [{ $group: { _id: '$horizon', count: { $sum: 1 } } }],
          byLabel: [{ $group: { _id: { $ifNull: ['$label', 'PENDING'] }, count: { $sum: 1 } } }],
        },
      },
    ];

    const [result] = await this.collection.aggregate(pipeline).toArray();

    const byStatus: Record<SampleStatus, number> = {
      PENDING: 0, RESOLVED: 0, EXPIRED: 0, ERROR: 0,
    };
    for (const item of result.byStatus) {
      byStatus[item._id as SampleStatus] = item.count;
    }

    const byHorizon: Record<Horizon, number> = { '1D': 0, '7D': 0, '30D': 0 };
    for (const item of result.byHorizon) {
      byHorizon[item._id as Horizon] = item.count;
    }

    const byLabel: Record<DirLabel | 'PENDING', number> = {
      UP: 0, DOWN: 0, NEUTRAL: 0, PENDING: 0,
    };
    for (const item of result.byLabel) {
      byLabel[item._id as any] = item.count;
    }

    // Calculate direction accuracy (non-neutral accuracy)
    const upDown = byLabel.UP + byLabel.DOWN;
    const accuracy = upDown > 0 ? byLabel.UP / upDown : 0.5;

    return {
      total: result.total[0]?.count || 0,
      byStatus,
      byHorizon,
      byLabel,
      accuracy,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let serviceInstance: DirDatasetService | null = null;

export function getDirDatasetService(db: Db): DirDatasetService {
  if (!serviceInstance) {
    serviceInstance = new DirDatasetService(db);
  }
  return serviceInstance;
}

console.log('[Exchange ML] Direction dataset service loaded');
