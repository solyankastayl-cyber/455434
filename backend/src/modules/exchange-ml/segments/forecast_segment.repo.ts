/**
 * Forecast Segment Repository (BLOCK 4)
 * 
 * Data access layer for forecast segments.
 */

import { Db } from 'mongodb';
import {
  ForecastSegment,
  SegmentLayer,
  SegmentHorizon,
  SegmentStatus,
  RolloverReason,
} from './forecast_segment.model.js';

const COLLECTION = 'forecast_segments';

export class ForecastSegmentRepo {
  constructor(private db: Db) {}
  
  // ═══════════════════════════════════════════════════════════════
  // READ
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get ACTIVE segment for a symbol/layer/horizon.
   */
  async getActive(params: {
    symbol: string;
    layer: SegmentLayer;
    horizon: SegmentHorizon;
  }): Promise<ForecastSegment | null> {
    const doc = await this.db.collection(COLLECTION).findOne(
      {
        symbol: params.symbol,
        layer: params.layer,
        horizon: params.horizon,
        status: 'ACTIVE',
      },
      { projection: { _id: 0 } }
    );
    return doc as ForecastSegment | null;
  }
  
  /**
   * Get segment by ID.
   */
  async getById(segmentId: string): Promise<ForecastSegment | null> {
    const doc = await this.db.collection(COLLECTION).findOne(
      { segmentId },
      { projection: { _id: 0 } }
    );
    return doc as ForecastSegment | null;
  }
  
  /**
   * List segments for a symbol/layer/horizon.
   * Returns both ACTIVE and GHOST segments (newest first).
   */
  async list(params: {
    symbol: string;
    layer: SegmentLayer;
    horizon: SegmentHorizon;
    status?: SegmentStatus;
    limit?: number;
  }): Promise<ForecastSegment[]> {
    const filter: any = {
      symbol: params.symbol,
      layer: params.layer,
      horizon: params.horizon,
    };
    
    if (params.status) {
      filter.status = params.status;
    }
    
    const docs = await this.db.collection(COLLECTION)
      .find(filter, { projection: { _id: 0 } })
      .sort({ startTs: -1 })
      .limit(params.limit ?? 50)
      .toArray();
    
    return docs as ForecastSegment[];
  }
  
  // ═══════════════════════════════════════════════════════════════
  // WRITE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Insert new segment.
   */
  async insert(segment: ForecastSegment): Promise<ForecastSegment> {
    await this.db.collection(COLLECTION).insertOne(segment as any);
    return segment;
  }
  
  /**
   * Mark ACTIVE segment as GHOST.
   * Returns the ghosted segment if found.
   */
  async markActiveAsGhost(params: {
    symbol: string;
    layer: SegmentLayer;
    horizon: SegmentHorizon;
    reason: RolloverReason;
  }): Promise<ForecastSegment | null> {
    const active = await this.getActive(params);
    
    if (!active) return null;
    
    await this.db.collection(COLLECTION).updateOne(
      { segmentId: active.segmentId },
      {
        $set: {
          status: 'GHOST',
          reason: params.reason,
          updatedAt: new Date(),
        },
      }
    );
    
    return active;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Delete old GHOST segments (keep only N most recent).
   */
  async pruneGhosts(params: {
    symbol: string;
    layer: SegmentLayer;
    horizon: SegmentHorizon;
    keepCount: number;
  }): Promise<number> {
    const ghosts = await this.list({
      ...params,
      status: 'GHOST',
      limit: 1000, // Get all
    });
    
    if (ghosts.length <= params.keepCount) return 0;
    
    // Delete oldest ones
    const toDelete = ghosts.slice(params.keepCount);
    const segmentIds = toDelete.map(g => g.segmentId);
    
    const result = await this.db.collection(COLLECTION).deleteMany({
      segmentId: { $in: segmentIds },
    });
    
    return result.deletedCount;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get segment statistics.
   */
  async getStats(): Promise<{
    total: number;
    byStatus: Record<SegmentStatus, number>;
    byHorizon: Record<SegmentHorizon, number>;
    byLayer: Record<SegmentLayer, number>;
  }> {
    const collection = this.db.collection(COLLECTION);
    
    const [total, statusAgg, horizonAgg, layerAgg] = await Promise.all([
      collection.countDocuments(),
      collection.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]).toArray(),
      collection.aggregate([
        { $group: { _id: '$horizon', count: { $sum: 1 } } },
      ]).toArray(),
      collection.aggregate([
        { $group: { _id: '$layer', count: { $sum: 1 } } },
      ]).toArray(),
    ]);
    
    const byStatus: Record<string, number> = { ACTIVE: 0, GHOST: 0 };
    for (const item of statusAgg) {
      byStatus[item._id] = item.count;
    }
    
    const byHorizon: Record<string, number> = { '1D': 0, '7D': 0, '30D': 0 };
    for (const item of horizonAgg) {
      byHorizon[item._id] = item.count;
    }
    
    const byLayer: Record<string, number> = { forecast: 0, exchange: 0, onchain: 0, sentiment: 0 };
    for (const item of layerAgg) {
      byLayer[item._id] = item.count;
    }
    
    return {
      total,
      byStatus: byStatus as Record<SegmentStatus, number>,
      byHorizon: byHorizon as Record<SegmentHorizon, number>,
      byLayer: byLayer as Record<SegmentLayer, number>,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INDEXES
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    const collection = this.db.collection(COLLECTION);
    
    await Promise.all([
      collection.createIndex(
        { symbol: 1, layer: 1, horizon: 1, status: 1, startTs: -1 },
        { name: 'active_segment_lookup' }
      ),
      collection.createIndex({ segmentId: 1 }, { unique: true, name: 'segmentId_unique' }),
      collection.createIndex(
        { symbol: 1, layer: 1, horizon: 1, startTs: -1 },
        { name: 'segment_timeline' }
      ),
    ]);
    
    console.log('[SegmentRepo] Indexes ensured');
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let repoInstance: ForecastSegmentRepo | null = null;

export function getForecastSegmentRepo(db: Db): ForecastSegmentRepo {
  if (!repoInstance) {
    repoInstance = new ForecastSegmentRepo(db);
  }
  return repoInstance;
}

console.log('[Forecast] Segment Repo loaded (BLOCK 4)');
