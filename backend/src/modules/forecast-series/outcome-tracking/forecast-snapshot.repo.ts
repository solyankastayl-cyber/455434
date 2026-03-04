/**
 * FORECAST SNAPSHOT REPOSITORY
 * ============================
 * 
 * V3.4: Outcome Tracking - Snapshot persistence layer
 * 
 * Manages CRUD operations for forecast_snapshots collection
 */

import type { Db, Collection, ObjectId, WithId } from 'mongodb';
import type { 
  ForecastSnapshot, 
  ForecastLayer, 
  ForecastHorizon,
  EvaluationResult 
} from './forecast-snapshot.types.js';

const COLLECTION_NAME = 'forecast_snapshots';

export class ForecastSnapshotRepo {
  private collection: Collection<ForecastSnapshot>;

  constructor(db: Db) {
    this.collection = db.collection(COLLECTION_NAME);
    this.ensureIndexes().catch(err => {
      console.error('[ForecastSnapshotRepo] Index creation failed:', err.message);
    });
  }

  private async ensureIndexes(): Promise<void> {
    try {
      // Index for finding pending snapshots to resolve
      await this.collection.createIndex(
        { 'evaluation.status': 1, resolveAt: 1 },
        { name: 'pending_resolve_idx' }
      );
      
      // Index for queries by symbol + layer + horizon
      await this.collection.createIndex(
        { symbol: 1, layer: 1, horizon: 1, createdAt: -1 },
        { name: 'symbol_layer_horizon_idx' }
      );
      
      // Unique constraint: one snapshot per symbol+layer+horizon per day
      await this.collection.createIndex(
        { symbol: 1, layer: 1, horizon: 1, createdAt: 1 },
        { name: 'unique_daily_snapshot_idx' }
      );
      
      console.log('[ForecastSnapshotRepo] Indexes ensured');
    } catch (err) {
      console.error('[ForecastSnapshotRepo] Index error:', err);
    }
  }

  /**
   * Create a new forecast snapshot
   */
  async create(snapshot: Omit<ForecastSnapshot, '_id'>): Promise<string> {
    const result = await this.collection.insertOne(snapshot as ForecastSnapshot);
    return result.insertedId.toString();
  }

  /**
   * Get snapshot by ID
   */
  async getById(id: string): Promise<ForecastSnapshot | null> {
    const { ObjectId } = await import('mongodb');
    const doc = await this.collection.findOne({ _id: new ObjectId(id) as any });
    if (!doc) return null;
    return this.serialize(doc);
  }

  /**
   * Get all pending snapshots that are ready to resolve
   */
  async getPendingToResolve(limit: number = 50): Promise<ForecastSnapshot[]> {
    const now = new Date();
    const docs = await this.collection
      .find({
        'evaluation.status': 'PENDING',
        resolveAt: { $lte: now },
      })
      .sort({ resolveAt: 1 })
      .limit(limit)
      .toArray();
    
    return docs.map(doc => this.serialize(doc));
  }

  /**
   * Update snapshot with evaluation result
   */
  async resolve(
    id: string,
    evaluation: {
      realPrice: number;
      result: EvaluationResult;
      deviation: number;
    }
  ): Promise<boolean> {
    const { ObjectId } = await import('mongodb');
    const result = await this.collection.updateOne(
      { _id: new ObjectId(id) as any },
      {
        $set: {
          'evaluation.status': 'RESOLVED',
          'evaluation.resolvedAt': new Date(),
          'evaluation.realPrice': evaluation.realPrice,
          'evaluation.result': evaluation.result,
          'evaluation.deviation': evaluation.deviation,
        },
      }
    );
    return result.modifiedCount > 0;
  }

  /**
   * Get recent snapshots for a symbol/layer/horizon
   */
  async getRecent(
    symbol: string,
    layer: ForecastLayer,
    horizon: ForecastHorizon,
    limit: number = 30
  ): Promise<ForecastSnapshot[]> {
    const docs = await this.collection
      .find({ symbol, layer, horizon })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    
    return docs.map(doc => this.serialize(doc));
  }

  /**
   * Check if snapshot exists for today
   */
  async existsToday(
    symbol: string,
    layer: ForecastLayer,
    horizon: ForecastHorizon
  ): Promise<boolean> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    
    const count = await this.collection.countDocuments({
      symbol,
      layer,
      horizon,
      createdAt: { $gte: today, $lt: tomorrow },
    });
    
    return count > 0;
  }

  /**
   * Get statistics for a layer/horizon
   */
  async getStats(
    symbol: string,
    layer: ForecastLayer,
    horizon: ForecastHorizon
  ): Promise<{
    total: number;
    pending: number;
    resolved: number;
    wins: number;
    losses: number;
  }> {
    const pipeline = [
      { $match: { symbol, layer, horizon } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ['$evaluation.status', 'PENDING'] }, 1, 0] },
          },
          resolved: {
            $sum: { $cond: [{ $eq: ['$evaluation.status', 'RESOLVED'] }, 1, 0] },
          },
          wins: {
            $sum: { $cond: [{ $eq: ['$evaluation.result', 'WIN'] }, 1, 0] },
          },
          losses: {
            $sum: { $cond: [{ $eq: ['$evaluation.result', 'LOSS'] }, 1, 0] },
          },
        },
      },
    ];
    
    const results = await this.collection.aggregate(pipeline).toArray();
    
    if (results.length === 0) {
      return { total: 0, pending: 0, resolved: 0, wins: 0, losses: 0 };
    }
    
    const r = results[0];
    return {
      total: r.total || 0,
      pending: r.pending || 0,
      resolved: r.resolved || 0,
      wins: r.wins || 0,
      losses: r.losses || 0,
    };
  }

  /**
   * Convert MongoDB doc to plain object
   */
  private serialize(doc: WithId<ForecastSnapshot>): ForecastSnapshot {
    const { _id, ...rest } = doc;
    return {
      _id: _id.toString(),
      ...rest,
    };
  }
}

// Singleton instance
let repoInstance: ForecastSnapshotRepo | null = null;

export function getForecastSnapshotRepo(db: Db): ForecastSnapshotRepo {
  if (!repoInstance) {
    repoInstance = new ForecastSnapshotRepo(db);
  }
  return repoInstance;
}

console.log('[ForecastSnapshotRepo] V3.4 Repository loaded');
