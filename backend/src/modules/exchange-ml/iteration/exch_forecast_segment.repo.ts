/**
 * Exchange Forecast Segment Repository (BLOCK 5.2)
 */

import { Db } from 'mongodb';
import {
  ExchForecastSegment,
  ExchHorizon,
  ExchSegmentStatus,
} from './exch_forecast_segment.model.js';

const COLLECTION = 'exch_forecast_segments';

export class ExchForecastSegmentRepo {
  constructor(private db: Db) {}
  
  // ═══════════════════════════════════════════════════════════════
  // READ
  // ═══════════════════════════════════════════════════════════════
  
  async getActive(asset: string, horizon: ExchHorizon): Promise<ExchForecastSegment | null> {
    const doc = await this.db.collection(COLLECTION).findOne(
      { asset: asset.toUpperCase(), horizon, status: 'ACTIVE' },
      { projection: { _id: 0 } }
    );
    return doc as ExchForecastSegment | null;
  }
  
  async findBySegmentId(segmentId: string): Promise<ExchForecastSegment | null> {
    const doc = await this.db.collection(COLLECTION).findOne(
      { segmentId },
      { projection: { _id: 0 } }
    );
    return doc as ExchForecastSegment | null;
  }
  
  async list(
    asset: string,
    horizon: ExchHorizon,
    limit: number = 50
  ): Promise<ExchForecastSegment[]> {
    const docs = await this.db.collection(COLLECTION)
      .find(
        { asset: asset.toUpperCase(), horizon },
        { projection: { _id: 0 } }
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return docs as ExchForecastSegment[];
  }
  
  async findRecentlyResolved(
    horizon: ExchHorizon,
    sinceMinutes: number = 120
  ): Promise<ExchForecastSegment[]> {
    const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
    
    const docs = await this.db.collection(COLLECTION)
      .find({
        horizon,
        status: 'RESOLVED',
        resolvedAt: { $gte: since },
      }, { projection: { _id: 0 } })
      .toArray();
    
    return docs as ExchForecastSegment[];
  }
  
  async findPendingResolution(
    horizon: ExchHorizon,
    beforeTimestamp: Date,
    limit: number = 100
  ): Promise<ExchForecastSegment[]> {
    const docs = await this.db.collection(COLLECTION)
      .find({
        horizon,
        status: { $in: ['ACTIVE', 'SUPERSEDED'] },
        createdAt: { $lt: beforeTimestamp },
      }, { projection: { _id: 0 } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
    
    return docs as ExchForecastSegment[];
  }
  
  // ═══════════════════════════════════════════════════════════════
  // WRITE
  // ═══════════════════════════════════════════════════════════════
  
  async insert(doc: ExchForecastSegment): Promise<ExchForecastSegment> {
    await this.db.collection(COLLECTION).insertOne(doc as any);
    return doc;
  }
  
  async supersedeActive(
    asset: string,
    horizon: ExchHorizon,
    at: Date = new Date()
  ): Promise<number> {
    const result = await this.db.collection(COLLECTION).updateMany(
      { asset: asset.toUpperCase(), horizon, status: 'ACTIVE' },
      { $set: { status: 'SUPERSEDED', supersededAt: at } }
    );
    return result.modifiedCount;
  }
  
  async markResolved(
    segmentId: string,
    outcome: 'WIN' | 'LOSS' | 'NEUTRAL',
    actualReturn: number,
    at: Date = new Date()
  ): Promise<boolean> {
    const result = await this.db.collection(COLLECTION).updateOne(
      { segmentId, status: { $in: ['ACTIVE', 'SUPERSEDED'] } },
      {
        $set: {
          status: 'RESOLVED',
          resolvedAt: at,
          outcome,
          actualReturn,
        },
      }
    );
    return result.modifiedCount > 0;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════
  
  async getStats(): Promise<{
    total: number;
    byStatus: Record<ExchSegmentStatus, number>;
    byHorizon: Record<ExchHorizon, number>;
  }> {
    const collection = this.db.collection(COLLECTION);
    
    const [total, statusAgg, horizonAgg] = await Promise.all([
      collection.countDocuments(),
      collection.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]).toArray(),
      collection.aggregate([
        { $group: { _id: '$horizon', count: { $sum: 1 } } },
      ]).toArray(),
    ]);
    
    const byStatus: Record<string, number> = { ACTIVE: 0, SUPERSEDED: 0, RESOLVED: 0 };
    for (const item of statusAgg) {
      byStatus[item._id] = item.count;
    }
    
    const byHorizon: Record<string, number> = { '1D': 0, '7D': 0, '30D': 0 };
    for (const item of horizonAgg) {
      byHorizon[item._id] = item.count;
    }
    
    return {
      total,
      byStatus: byStatus as Record<ExchSegmentStatus, number>,
      byHorizon: byHorizon as Record<ExchHorizon, number>,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INDEXES
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    const collection = this.db.collection(COLLECTION);
    
    await Promise.all([
      collection.createIndex(
        { asset: 1, horizon: 1 },
        { partialFilterExpression: { status: 'ACTIVE' }, name: 'active_unique' }
      ),
      collection.createIndex({ segmentId: 1 }, { unique: true, name: 'segmentId_unique' }),
      collection.createIndex({ asset: 1, horizon: 1, createdAt: -1 }, { name: 'timeline' }),
      collection.createIndex({ asset: 1, horizon: 1, status: 1 }, { name: 'status_lookup' }),
      collection.createIndex({ horizon: 1, status: 1, resolvedAt: 1 }, { name: 'resolution' }),
    ]);
    
    console.log('[ExchSegmentRepo] Indexes ensured');
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let repoInstance: ExchForecastSegmentRepo | null = null;

export function getExchForecastSegmentRepo(db: Db): ExchForecastSegmentRepo {
  if (!repoInstance) {
    repoInstance = new ExchForecastSegmentRepo(db);
  }
  return repoInstance;
}

console.log('[Exchange ML] Forecast Segment Repo loaded (BLOCK 5.2)');
