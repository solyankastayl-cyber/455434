/**
 * Exchange Auto-Learning Loop - PR3: Shadow Recorder Service
 * 
 * Records shadow predictions for comparison:
 * - Stores dual predictions (active + shadow)
 * - Tracks when predictions resolve
 * - Provides data for metrics calculation
 */

import { Db, Collection, ObjectId } from 'mongodb';
import { ShadowPrediction } from './exchange_shadow.types.js';
import { ExchangeHorizon, LabelResult } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_NAME = 'exch_shadow_predictions';

// ═══════════════════════════════════════════════════════════════
// SHADOW RECORDER SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeShadowRecorderService {
  private collection: Collection<ShadowPrediction>;
  
  constructor(private db: Db) {
    this.collection = db.collection<ShadowPrediction>(COLLECTION_NAME);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    // Unique index on sampleId (one shadow prediction per sample)
    await this.collection.createIndex(
      { sampleId: 1 },
      { unique: true, name: 'idx_shadow_sample' }
    );
    
    // Index for finding unresolved predictions
    await this.collection.createIndex(
      { resolved: 1, horizon: 1 },
      { name: 'idx_shadow_unresolved' }
    );
    
    // Index for time-based queries
    await this.collection.createIndex(
      { createdAt: -1 },
      { name: 'idx_shadow_created' }
    );
    
    // Index for metrics calculation
    await this.collection.createIndex(
      { horizon: 1, resolved: 1, createdAt: -1 },
      { name: 'idx_shadow_metrics' }
    );
    
    console.log('[ShadowRecorderService] Indexes ensured');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // RECORD PREDICTION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Record a dual prediction (active + shadow).
   */
  async record(params: {
    sampleId: string;
    horizon: ExchangeHorizon;
    symbol: string;
    activeModelId: string;
    activeModelVersion: number;
    shadowModelId: string;
    shadowModelVersion: number;
    activePrediction: number;
    shadowPrediction: number;
    winThreshold: number;
    latencyMs: number;
  }): Promise<{ id: string; created: boolean }> {
    const {
      sampleId,
      horizon,
      symbol,
      activeModelId,
      activeModelVersion,
      shadowModelId,
      shadowModelVersion,
      activePrediction,
      shadowPrediction,
      winThreshold,
      latencyMs,
    } = params;
    
    const now = new Date();
    
    const record: ShadowPrediction = {
      sampleId,
      horizon,
      symbol,
      activeModelId,
      activeModelVersion,
      shadowModelId,
      shadowModelVersion,
      activePrediction,
      shadowPrediction,
      activeClass: activePrediction >= winThreshold ? 'WIN' : 'LOSS',
      shadowClass: shadowPrediction >= winThreshold ? 'WIN' : 'LOSS',
      resolved: false,
      actualLabel: null,
      activeCorrect: null,
      shadowCorrect: null,
      resolvedAt: null,
      createdAt: now,
      inferenceLatencyMs: latencyMs,
    };
    
    try {
      const result = await this.collection.insertOne(record as any);
      return { id: result.insertedId.toString(), created: true };
    } catch (err: any) {
      // Duplicate - already recorded
      if (err.code === 11000) {
        const existing = await this.collection.findOne({ sampleId });
        return { id: existing?._id?.toString() || '', created: false };
      }
      throw err;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // RESOLVE PREDICTIONS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Resolve a shadow prediction when sample label is determined.
   * Called by PR1 label worker after resolution.
   */
  async resolvePrediction(params: {
    sampleId: string;
    actualLabel: LabelResult;
  }): Promise<boolean> {
    const { sampleId, actualLabel } = params;
    
    // Find the shadow prediction
    const prediction = await this.collection.findOne({ sampleId });
    
    if (!prediction) {
      // No shadow prediction for this sample (shadow was disabled)
      return false;
    }
    
    if (prediction.resolved) {
      // Already resolved
      return true;
    }
    
    // Determine correctness
    // WIN/LOSS only (NEUTRAL is neither correct nor incorrect)
    let activeCorrect: boolean | null = null;
    let shadowCorrect: boolean | null = null;
    
    if (actualLabel === 'WIN' || actualLabel === 'LOSS') {
      activeCorrect = prediction.activeClass === actualLabel;
      shadowCorrect = prediction.shadowClass === actualLabel;
    }
    
    // Update record
    const result = await this.collection.updateOne(
      { sampleId },
      {
        $set: {
          resolved: true,
          actualLabel,
          activeCorrect,
          shadowCorrect,
          resolvedAt: new Date(),
        },
      }
    );
    
    if (result.modifiedCount > 0) {
      const activeResult = activeCorrect ? '✓' : '✗';
      const shadowResult = shadowCorrect ? '✓' : '✗';
      console.log(
        `[ShadowRecorder] Resolved ${sampleId}: ` +
        `label=${actualLabel} active=${activeResult} shadow=${shadowResult}`
      );
    }
    
    return result.modifiedCount > 0;
  }
  
  /**
   * Batch resolve predictions for multiple samples.
   */
  async resolveMany(resolutions: Array<{ sampleId: string; actualLabel: LabelResult }>): Promise<number> {
    let resolved = 0;
    
    for (const r of resolutions) {
      const success = await this.resolvePrediction(r);
      if (success) resolved++;
    }
    
    return resolved;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // QUERY PREDICTIONS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get recent predictions for a horizon.
   */
  async getRecentPredictions(params: {
    horizon: ExchangeHorizon;
    resolvedOnly?: boolean;
    limit?: number;
  }): Promise<ShadowPrediction[]> {
    const { horizon, resolvedOnly = false, limit = 100 } = params;
    
    const query: any = { horizon };
    if (resolvedOnly) {
      query.resolved = true;
    }
    
    return this.collection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray() as Promise<ShadowPrediction[]>;
  }
  
  /**
   * Get unresolved predictions ready for resolution.
   */
  async getUnresolvedPredictions(limit: number = 100): Promise<ShadowPrediction[]> {
    return this.collection
      .find({ resolved: false })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray() as Promise<ShadowPrediction[]>;
  }
  
  /**
   * Get prediction by sample ID.
   */
  async getPredictionBySampleId(sampleId: string): Promise<ShadowPrediction | null> {
    return this.collection.findOne({ sampleId }) as Promise<ShadowPrediction | null>;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // AGGREGATION FOR METRICS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get resolved predictions for metrics calculation.
   */
  async getResolvedForMetrics(params: {
    horizon: ExchangeHorizon;
    activeModelId?: string;
    shadowModelId?: string;
    limit?: number;
  }): Promise<ShadowPrediction[]> {
    const { horizon, activeModelId, shadowModelId, limit = 1000 } = params;
    
    const query: any = {
      horizon,
      resolved: true,
      actualLabel: { $in: ['WIN', 'LOSS'] }, // Exclude NEUTRAL
    };
    
    if (activeModelId) {
      query.activeModelId = activeModelId;
    }
    
    if (shadowModelId) {
      query.shadowModelId = shadowModelId;
    }
    
    return this.collection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray() as Promise<ShadowPrediction[]>;
  }
  
  /**
   * Get counts by horizon.
   */
  async getCounts(): Promise<{
    byHorizon: Record<ExchangeHorizon, { total: number; resolved: number; pending: number }>;
  }> {
    const pipeline = [
      {
        $group: {
          _id: { horizon: '$horizon', resolved: '$resolved' },
          count: { $sum: 1 },
        },
      },
    ];
    
    const results = await this.collection.aggregate(pipeline).toArray();
    
    const byHorizon: Record<ExchangeHorizon, { total: number; resolved: number; pending: number }> = {
      '1D': { total: 0, resolved: 0, pending: 0 },
      '7D': { total: 0, resolved: 0, pending: 0 },
      '30D': { total: 0, resolved: 0, pending: 0 },
    };
    
    for (const r of results) {
      const horizon = r._id.horizon as ExchangeHorizon;
      const isResolved = r._id.resolved;
      
      if (byHorizon[horizon]) {
        byHorizon[horizon].total += r.count;
        if (isResolved) {
          byHorizon[horizon].resolved += r.count;
        } else {
          byHorizon[horizon].pending += r.count;
        }
      }
    }
    
    return { byHorizon };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let recorderInstance: ExchangeShadowRecorderService | null = null;

export function getExchangeShadowRecorderService(db: Db): ExchangeShadowRecorderService {
  if (!recorderInstance) {
    recorderInstance = new ExchangeShadowRecorderService(db);
  }
  return recorderInstance;
}

console.log('[Exchange ML] Shadow recorder service loaded');
