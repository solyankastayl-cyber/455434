/**
 * Exchange Prediction Snapshot Repository (BLOCK 1)
 * 
 * Data access layer for prediction snapshots.
 * Provides atomic operations for snapshot lifecycle.
 */

import { Db, ClientSession } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  ExchangePredictionSnapshot,
  SnapshotStatus,
  SnapshotOutcome,
} from './exchange_prediction_snapshot.model.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// COLLECTION NAME
// ═══════════════════════════════════════════════════════════════

const COLLECTION = 'exchange_prediction_snapshots';

// ═══════════════════════════════════════════════════════════════
// REPOSITORY
// ═══════════════════════════════════════════════════════════════

export class ExchangePredictionSnapshotRepo {
  constructor(private db: Db) {}
  
  // ═══════════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Create a new snapshot.
   */
  async create(
    data: Omit<ExchangePredictionSnapshot, 'snapshotId' | '_id' | 'createdAt' | 'status'>,
    session?: ClientSession
  ): Promise<ExchangePredictionSnapshot> {
    const snapshot: ExchangePredictionSnapshot = {
      snapshotId: `snap_${uuidv4()}`,
      ...data,
      status: 'ACTIVE',
      createdAt: new Date(),
    };
    
    await this.db.collection(COLLECTION).insertOne(snapshot as any, { session });
    
    return snapshot;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // READ
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get snapshot by ID.
   */
  async getById(snapshotId: string): Promise<ExchangePredictionSnapshot | null> {
    const doc = await this.db.collection(COLLECTION).findOne(
      { snapshotId },
      { projection: { _id: 0 } }
    );
    return doc as ExchangePredictionSnapshot | null;
  }
  
  /**
   * Get ACTIVE snapshot for a symbol/horizon.
   * There can be only ONE active snapshot per symbol+horizon.
   */
  async getActive(
    symbol: string,
    horizon: ExchangeHorizon
  ): Promise<ExchangePredictionSnapshot | null> {
    const doc = await this.db.collection(COLLECTION).findOne(
      { symbol, horizon, status: 'ACTIVE' },
      { projection: { _id: 0 } }
    );
    return doc as ExchangePredictionSnapshot | null;
  }
  
  /**
   * Get all ACTIVE snapshots for a horizon.
   */
  async getAllActive(horizon: ExchangeHorizon): Promise<ExchangePredictionSnapshot[]> {
    const docs = await this.db.collection(COLLECTION)
      .find({ horizon, status: 'ACTIVE' }, { projection: { _id: 0 } })
      .toArray();
    return docs as ExchangePredictionSnapshot[];
  }
  
  /**
   * Get snapshot history for a symbol/horizon (newest first).
   */
  async getHistory(
    symbol: string,
    horizon: ExchangeHorizon,
    limit: number = 50
  ): Promise<ExchangePredictionSnapshot[]> {
    const docs = await this.db.collection(COLLECTION)
      .find({ symbol, horizon }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return docs as ExchangePredictionSnapshot[];
  }
  
  /**
   * Get snapshots by horizon with optional status filter.
   */
  async getByHorizon(
    horizon: ExchangeHorizon,
    options: {
      status?: SnapshotStatus;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<ExchangePredictionSnapshot[]> {
    const { status, limit = 100, offset = 0 } = options;
    
    const filter: any = { horizon };
    if (status) filter.status = status;
    
    const docs = await this.db.collection(COLLECTION)
      .find(filter, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    
    return docs as ExchangePredictionSnapshot[];
  }
  
  /**
   * Get pending snapshots that need resolution (past their horizon window).
   */
  async getPendingResolution(
    horizon: ExchangeHorizon,
    beforeTimestamp: Date,
    limit: number = 100
  ): Promise<ExchangePredictionSnapshot[]> {
    const docs = await this.db.collection(COLLECTION)
      .find({
        horizon,
        status: { $in: ['ACTIVE', 'ARCHIVED'] },
        entryTimestamp: { $lt: beforeTimestamp },
      }, { projection: { _id: 0 } })
      .sort({ entryTimestamp: 1 })
      .limit(limit)
      .toArray();
    
    return docs as ExchangePredictionSnapshot[];
  }
  
  // ═══════════════════════════════════════════════════════════════
  // UPDATE (Status transitions only - snapshots are immutable)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Archive a snapshot (ACTIVE → ARCHIVED).
   * Used when a new prediction supersedes the old one.
   */
  async archive(
    snapshotId: string,
    session?: ClientSession
  ): Promise<boolean> {
    const result = await this.db.collection(COLLECTION).updateOne(
      { snapshotId, status: 'ACTIVE' },
      { $set: { status: 'ARCHIVED', archivedAt: new Date() } },
      { session }
    );
    return result.modifiedCount > 0;
  }
  
  /**
   * Archive active snapshot by symbol/horizon.
   * Returns the archived snapshot ID if found.
   */
  async archiveActiveByTarget(
    symbol: string,
    horizon: ExchangeHorizon,
    session?: ClientSession
  ): Promise<string | null> {
    const activeDoc = await this.db.collection(COLLECTION).findOneAndUpdate(
      { symbol, horizon, status: 'ACTIVE' },
      { $set: { status: 'ARCHIVED', archivedAt: new Date() } },
      { session, returnDocument: 'before' }
    );
    
    return activeDoc ? (activeDoc as any).snapshotId : null;
  }
  
  /**
   * Resolve a snapshot (ACTIVE/ARCHIVED → RESOLVED).
   * Called when the prediction outcome is determined.
   */
  async resolve(
    snapshotId: string,
    resolution: {
      outcome: SnapshotOutcome;
      exitPrice: number;
      priceChangePercent: number;
    }
  ): Promise<boolean> {
    const result = await this.db.collection(COLLECTION).updateOne(
      { snapshotId, status: { $in: ['ACTIVE', 'ARCHIVED'] } },
      {
        $set: {
          status: 'RESOLVED',
          outcome: resolution.outcome,
          exitPrice: resolution.exitPrice,
          exitTimestamp: new Date(),
          priceChangePercent: resolution.priceChangePercent,
          resolvedAt: new Date(),
        },
      }
    );
    return result.modifiedCount > 0;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get snapshot statistics.
   */
  async getStats(): Promise<{
    total: number;
    byStatus: Record<SnapshotStatus, number>;
    byHorizon: Record<ExchangeHorizon, number>;
    byOutcome: Record<string, number>;
    oldestActive: Date | null;
    newestActive: Date | null;
  }> {
    const collection = this.db.collection(COLLECTION);
    
    const [total, statusAgg, horizonAgg, outcomeAgg, oldestActive, newestActive] = await Promise.all([
      collection.countDocuments(),
      collection.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]).toArray(),
      collection.aggregate([
        { $group: { _id: '$horizon', count: { $sum: 1 } } },
      ]).toArray(),
      collection.aggregate([
        { $match: { status: 'RESOLVED' } },
        { $group: { _id: '$outcome', count: { $sum: 1 } } },
      ]).toArray(),
      collection.findOne(
        { status: 'ACTIVE' },
        { sort: { createdAt: 1 }, projection: { createdAt: 1 } }
      ),
      collection.findOne(
        { status: 'ACTIVE' },
        { sort: { createdAt: -1 }, projection: { createdAt: 1 } }
      ),
    ]);
    
    const byStatus: Record<string, number> = { ACTIVE: 0, ARCHIVED: 0, RESOLVED: 0 };
    for (const item of statusAgg) {
      byStatus[item._id] = item.count;
    }
    
    const byHorizon: Record<string, number> = { '1D': 0, '7D': 0, '30D': 0 };
    for (const item of horizonAgg) {
      byHorizon[item._id] = item.count;
    }
    
    const byOutcome: Record<string, number> = { WIN: 0, LOSS: 0, NEUTRAL: 0 };
    for (const item of outcomeAgg) {
      if (item._id) byOutcome[item._id] = item.count;
    }
    
    return {
      total,
      byStatus: byStatus as Record<SnapshotStatus, number>,
      byHorizon: byHorizon as Record<ExchangeHorizon, number>,
      byOutcome,
      oldestActive: oldestActive ? (oldestActive as any).createdAt : null,
      newestActive: newestActive ? (newestActive as any).createdAt : null,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INDEXES
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Ensure all required indexes exist.
   */
  async ensureIndexes(): Promise<void> {
    const collection = this.db.collection(COLLECTION);
    
    await Promise.all([
      // Partial unique index for ACTIVE snapshots
      collection.createIndex(
        { symbol: 1, horizon: 1 },
        { unique: true, partialFilterExpression: { status: 'ACTIVE' }, name: 'active_unique' }
      ),
      // Primary lookup
      collection.createIndex({ snapshotId: 1 }, { unique: true, name: 'snapshotId_unique' }),
      // Timeline queries
      collection.createIndex({ symbol: 1, horizon: 1, createdAt: -1 }, { name: 'symbol_horizon_timeline' }),
      collection.createIndex({ horizon: 1, status: 1, createdAt: -1 }, { name: 'horizon_status_timeline' }),
      // Resolution queries
      collection.createIndex({ status: 1, entryTimestamp: 1 }, { name: 'pending_resolution' }),
      collection.createIndex({ horizon: 1, outcome: 1 }, { name: 'horizon_outcome' }),
      // Model binding
      collection.createIndex({ modelId: 1, modelVersion: 1 }, { name: 'model_binding' }),
      collection.createIndex({ retrainBatchId: 1 }, { name: 'retrain_batch' }),
    ]);
    
    console.log('[SnapshotRepo] Indexes ensured');
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let repoInstance: ExchangePredictionSnapshotRepo | null = null;

export function getExchangePredictionSnapshotRepo(db: Db): ExchangePredictionSnapshotRepo {
  if (!repoInstance) {
    repoInstance = new ExchangePredictionSnapshotRepo(db);
  }
  return repoInstance;
}

console.log('[Exchange ML] Prediction Snapshot Repo loaded');
