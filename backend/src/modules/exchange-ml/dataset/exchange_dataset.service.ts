/**
 * Exchange Auto-Learning Loop - PR1: Dataset Service
 * 
 * Core service for managing training samples:
 * - createSample(): Captures feature snapshot for each signal
 * - No lookahead bias: features are strictly from t0
 * - Unique key: (symbol, horizon, t0)
 */

import { Db, Collection, ObjectId } from 'mongodb';
import {
  ExchangeSample,
  ExchangeFeatureSnapshot,
  ExchangeHorizon,
  HORIZON_MS,
  SampleStatus,
  DatasetStats,
} from './exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_NAME = 'exch_dataset_samples';
const FEATURE_VERSION = 'v1.0.0';

// ═══════════════════════════════════════════════════════════════
// SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export class ExchangeDatasetService {
  private collection: Collection<ExchangeSample>;
  
  constructor(private db: Db) {
    this.collection = db.collection<ExchangeSample>(COLLECTION_NAME);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    // Unique compound index: one sample per (symbol, horizon, t0)
    await this.collection.createIndex(
      { symbol: 1, horizon: 1, t0: 1 },
      { unique: true, name: 'idx_unique_sample' }
    );
    
    // Index for finding pending samples
    await this.collection.createIndex(
      { status: 1, resolveAt: 1 },
      { name: 'idx_pending_resolution' }
    );
    
    // Index for querying by horizon
    await this.collection.createIndex(
      { horizon: 1, status: 1 },
      { name: 'idx_horizon_status' }
    );
    
    // Index for time-based queries
    await this.collection.createIndex(
      { createdAt: -1 },
      { name: 'idx_created_at' }
    );
    
    console.log('[ExchangeDatasetService] Indexes ensured');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CREATE SAMPLE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Create a new sample for a signal.
   * 
   * IMPORTANT: This must be called at signal time (t0).
   * Features must be from t0 only - NO LOOKAHEAD.
   * 
   * @param symbol - Trading pair (e.g., 'BTCUSDT')
   * @param horizon - Forecast horizon ('1D', '7D', '30D')
   * @param t0 - Signal timestamp
   * @param features - Feature snapshot at t0
   * @param entryPrice - Price at t0
   * @param signalMeta - Original signal metadata (optional)
   */
  async createSample(params: {
    symbol: string;
    horizon: ExchangeHorizon;
    t0: Date;
    features: ExchangeFeatureSnapshot;
    entryPrice: number;
    signalMeta?: ExchangeSample['signalMeta'];
  }): Promise<{ id: string; created: boolean }> {
    const { symbol, horizon, t0, features, entryPrice, signalMeta } = params;
    
    const now = new Date();
    const resolveAt = new Date(t0.getTime() + HORIZON_MS[horizon]);
    
    // Validate: t0 must not be in the future
    if (t0 > now) {
      throw new Error(`Invalid t0: cannot be in the future (t0=${t0.toISOString()}, now=${now.toISOString()})`);
    }
    
    // Validate: entryPrice must be positive
    if (entryPrice <= 0) {
      throw new Error(`Invalid entryPrice: must be positive (got ${entryPrice})`);
    }
    
    const sample: ExchangeSample = {
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
      signalMeta,
    };
    
    try {
      const result = await this.collection.insertOne(sample as any);
      console.log(`[ExchangeDatasetService] Sample created: ${symbol}/${horizon} at ${t0.toISOString()}`);
      return { id: result.insertedId.toString(), created: true };
    } catch (err: any) {
      // Handle duplicate key error (sample already exists)
      if (err.code === 11000) {
        console.log(`[ExchangeDatasetService] Sample already exists: ${symbol}/${horizon} at ${t0.toISOString()}`);
        
        // Find existing sample
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
  // QUERY SAMPLES
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get samples pending resolution.
   */
  async getPendingSamples(params: {
    horizon?: ExchangeHorizon;
    maxResolveAt?: Date;
    limit?: number;
  }): Promise<ExchangeSample[]> {
    const { horizon, maxResolveAt, limit = 100 } = params;
    
    const query: any = {
      status: 'PENDING',
    };
    
    if (horizon) {
      query.horizon = horizon;
    }
    
    if (maxResolveAt) {
      query.resolveAt = { $lte: maxResolveAt };
    }
    
    return this.collection
      .find(query)
      .sort({ resolveAt: 1 })
      .limit(limit)
      .toArray() as Promise<ExchangeSample[]>;
  }
  
  /**
   * Get samples ready for resolution (resolveAt <= now).
   */
  async getSamplesReadyForResolution(limit: number = 50): Promise<ExchangeSample[]> {
    const now = new Date();
    
    return this.collection
      .find({
        status: 'PENDING',
        resolveAt: { $lte: now },
      })
      .sort({ resolveAt: 1 })
      .limit(limit)
      .toArray() as Promise<ExchangeSample[]>;
  }
  
  /**
   * Get resolved samples for training.
   */
  async getResolvedSamples(params: {
    horizon?: ExchangeHorizon;
    minDate?: Date;
    maxDate?: Date;
    limit?: number;
  }): Promise<ExchangeSample[]> {
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
      .toArray() as Promise<ExchangeSample[]>;
  }
  
  /**
   * Get sample by ID.
   */
  async getSampleById(id: string): Promise<ExchangeSample | null> {
    try {
      return await this.collection.findOne({ _id: new ObjectId(id) as any }) as ExchangeSample | null;
    } catch {
      return null;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // UPDATE SAMPLE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Update sample with resolution result.
   */
  async resolveSample(params: {
    sampleId: string;
    exitPrice: number;
    returnPct: number;
    label: 'WIN' | 'LOSS' | 'NEUTRAL';
  }): Promise<boolean> {
    const { sampleId, exitPrice, returnPct, label } = params;
    
    const result = await this.collection.updateOne(
      { _id: new ObjectId(sampleId) as any },
      {
        $set: {
          exitPrice,
          returnPct,
          label,
          status: 'RESOLVED' as SampleStatus,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log(`[ExchangeDatasetService] Sample resolved: ${sampleId} -> ${label} (${(returnPct * 100).toFixed(2)}%)`);
    }
    
    return result.modifiedCount > 0;
  }
  
  /**
   * Mark sample as expired.
   */
  async expireSample(sampleId: string, reason: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: new ObjectId(sampleId) as any },
      {
        $set: {
          status: 'EXPIRED' as SampleStatus,
          updatedAt: new Date(),
        },
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log(`[ExchangeDatasetService] Sample expired: ${sampleId} - ${reason}`);
    }
    
    return result.modifiedCount > 0;
  }
  
  /**
   * Mark sample as error.
   */
  async markSampleError(sampleId: string, error: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: new ObjectId(sampleId) as any },
      {
        $set: {
          status: 'ERROR' as SampleStatus,
          updatedAt: new Date(),
        },
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log(`[ExchangeDatasetService] Sample error: ${sampleId} - ${error}`);
    }
    
    return result.modifiedCount > 0;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get dataset statistics.
   */
  async getStats(): Promise<DatasetStats> {
    const pipeline = [
      {
        $facet: {
          total: [{ $count: 'count' }],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ],
          byHorizon: [
            { $group: { _id: '$horizon', count: { $sum: 1 } } },
          ],
          byLabel: [
            { $group: { _id: { $ifNull: ['$label', 'PENDING'] }, count: { $sum: 1 } } },
          ],
          timeRange: [
            {
              $group: {
                _id: null,
                oldest: { $min: '$t0' },
                newest: { $max: '$t0' },
              },
            },
          ],
          pendingCount: [
            { $match: { status: 'PENDING' } },
            { $count: 'count' },
          ],
          winLoss: [
            { $match: { label: { $in: ['WIN', 'LOSS'] } } },
            { $group: { _id: '$label', count: { $sum: 1 } } },
          ],
        },
      },
    ];
    
    const [result] = await this.collection.aggregate(pipeline).toArray();
    
    const totalSamples = result.total[0]?.count || 0;
    
    const byStatus: Record<SampleStatus, number> = {
      PENDING: 0,
      RESOLVED: 0,
      EXPIRED: 0,
      ERROR: 0,
    };
    for (const item of result.byStatus) {
      byStatus[item._id as SampleStatus] = item.count;
    }
    
    const byHorizon: Record<ExchangeHorizon, number> = {
      '1D': 0,
      '7D': 0,
      '30D': 0,
    };
    for (const item of result.byHorizon) {
      byHorizon[item._id as ExchangeHorizon] = item.count;
    }
    
    const byLabel: Record<'WIN' | 'LOSS' | 'NEUTRAL' | 'PENDING', number> = {
      WIN: 0,
      LOSS: 0,
      NEUTRAL: 0,
      PENDING: 0,
    };
    for (const item of result.byLabel) {
      byLabel[item._id as any] = item.count;
    }
    
    // Calculate win rate
    let winRate = 0;
    const winCount = result.winLoss.find((x: any) => x._id === 'WIN')?.count || 0;
    const lossCount = result.winLoss.find((x: any) => x._id === 'LOSS')?.count || 0;
    if (winCount + lossCount > 0) {
      winRate = winCount / (winCount + lossCount);
    }
    
    return {
      totalSamples,
      byStatus,
      byHorizon,
      byLabel,
      oldestSample: result.timeRange[0]?.oldest || null,
      newestSample: result.timeRange[0]?.newest || null,
      avgResolutionDelayMs: 0, // TODO: Calculate from resolved samples
      pendingCount: result.pendingCount[0]?.count || 0,
      winRate,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let serviceInstance: ExchangeDatasetService | null = null;

export function getExchangeDatasetService(db: Db): ExchangeDatasetService {
  if (!serviceInstance) {
    serviceInstance = new ExchangeDatasetService(db);
  }
  return serviceInstance;
}

console.log('[Exchange ML] Dataset service loaded');
