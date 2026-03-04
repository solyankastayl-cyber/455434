/**
 * Exchange Auto-Learning Loop - PR4/5/6: Event Logger
 * 
 * Audit trail for all model lifecycle events:
 * - Promotions
 * - Rollbacks
 * - Config changes
 * - Kill switch activations
 */

import { Db, Collection } from 'mongodb';
import { ModelEvent, ModelEventType } from './exchange_lifecycle.config.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_NAME = 'exch_model_events';

// ═══════════════════════════════════════════════════════════════
// EVENT LOGGER SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeEventLoggerService {
  private collection: Collection<ModelEvent>;
  
  constructor(private db: Db) {
    this.collection = db.collection<ModelEvent>(COLLECTION_NAME);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { type: 1, horizon: 1, timestamp: -1 },
      { name: 'idx_event_type_horizon' }
    );
    
    await this.collection.createIndex(
      { timestamp: -1 },
      { name: 'idx_event_timestamp' }
    );
    
    await this.collection.createIndex(
      { horizon: 1, timestamp: -1 },
      { name: 'idx_event_horizon' }
    );
    
    console.log('[EventLogger] Indexes ensured');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // LOG EVENTS
  // ═══════════════════════════════════════════════════════════════
  
  async log(params: {
    type: ModelEventType;
    horizon: ExchangeHorizon | 'GLOBAL';
    fromModelId?: string;
    toModelId?: string;
    reason?: string;
    meta?: Record<string, any>;
  }): Promise<string> {
    const now = new Date();
    
    const event: ModelEvent = {
      type: params.type,
      horizon: params.horizon,
      fromModelId: params.fromModelId,
      toModelId: params.toModelId,
      reason: params.reason,
      meta: params.meta,
      timestamp: now,
      createdAt: now,
    };
    
    const result = await this.collection.insertOne(event as any);
    
    console.log(
      `[EventLogger] ${params.type} | ${params.horizon} | ` +
      `${params.reason || 'no reason'}`
    );
    
    return result.insertedId.toString();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SPECIFIC EVENT LOGGING
  // ═══════════════════════════════════════════════════════════════
  
  async logPromotion(params: {
    horizon: ExchangeHorizon;
    fromModelId: string;
    toModelId: string;
    improvement: number;
    sampleCount: number;
  }): Promise<string> {
    return this.log({
      type: 'PROMOTED',
      horizon: params.horizon,
      fromModelId: params.fromModelId,
      toModelId: params.toModelId,
      reason: `Improvement: ${(params.improvement * 100).toFixed(2)}%`,
      meta: {
        improvement: params.improvement,
        sampleCount: params.sampleCount,
      },
    });
  }
  
  async logRollback(params: {
    horizon: ExchangeHorizon;
    fromModelId: string;
    toModelId: string;
    reason: string;
    metrics?: Record<string, any>;
  }): Promise<string> {
    return this.log({
      type: 'ROLLED_BACK',
      horizon: params.horizon,
      fromModelId: params.fromModelId,
      toModelId: params.toModelId,
      reason: params.reason,
      meta: params.metrics,
    });
  }
  
  async logKillSwitch(enabled: boolean, reason?: string): Promise<string> {
    return this.log({
      type: enabled ? 'KILL_SWITCH_ON' : 'KILL_SWITCH_OFF',
      horizon: 'GLOBAL',
      reason: reason || (enabled ? 'Kill switch activated' : 'Kill switch deactivated'),
    });
  }
  
  async logPromotionLock(enabled: boolean, reason?: string): Promise<string> {
    return this.log({
      type: enabled ? 'PROMOTION_LOCK_ON' : 'PROMOTION_LOCK_OFF',
      horizon: 'GLOBAL',
      reason: reason || (enabled ? 'Promotion locked' : 'Promotion unlocked'),
    });
  }
  
  // ═══════════════════════════════════════════════════════════════
  // QUERY EVENTS
  // ═══════════════════════════════════════════════════════════════
  
  async getLastPromotion(horizon: ExchangeHorizon): Promise<ModelEvent | null> {
    return this.collection.findOne(
      { type: 'PROMOTED', horizon },
      { sort: { timestamp: -1 } }
    ) as Promise<ModelEvent | null>;
  }
  
  async getLastRollback(horizon: ExchangeHorizon): Promise<ModelEvent | null> {
    return this.collection.findOne(
      { type: 'ROLLED_BACK', horizon },
      { sort: { timestamp: -1 } }
    ) as Promise<ModelEvent | null>;
  }
  
  async getRecentEvents(params: {
    horizon?: ExchangeHorizon;
    type?: ModelEventType;
    limit?: number;
  }): Promise<ModelEvent[]> {
    const { horizon, type, limit = 50 } = params;
    
    const query: any = {};
    if (horizon) query.horizon = horizon;
    if (type) query.type = type;
    
    return this.collection
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray() as Promise<ModelEvent[]>;
  }
  
  async getEventsSince(since: Date, horizon?: ExchangeHorizon): Promise<ModelEvent[]> {
    const query: any = { timestamp: { $gte: since } };
    if (horizon) query.horizon = horizon;
    
    return this.collection
      .find(query)
      .sort({ timestamp: -1 })
      .toArray() as Promise<ModelEvent[]>;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════
  
  async getStats(): Promise<{
    totalEvents: number;
    byType: Record<string, number>;
    byHorizon: Record<string, number>;
    recentPromotions: number;
    recentRollbacks: number;
  }> {
    const [byType, byHorizon, total] = await Promise.all([
      this.collection.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]).toArray(),
      this.collection.aggregate([
        { $group: { _id: '$horizon', count: { $sum: 1 } } },
      ]).toArray(),
      this.collection.countDocuments({}),
    ]);
    
    // Last 7 days
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [recentPromotions, recentRollbacks] = await Promise.all([
      this.collection.countDocuments({ type: 'PROMOTED', timestamp: { $gte: weekAgo } }),
      this.collection.countDocuments({ type: 'ROLLED_BACK', timestamp: { $gte: weekAgo } }),
    ]);
    
    const typeMap: Record<string, number> = {};
    for (const t of byType) {
      typeMap[t._id] = t.count;
    }
    
    const horizonMap: Record<string, number> = {};
    for (const h of byHorizon) {
      horizonMap[h._id] = h.count;
    }
    
    return {
      totalEvents: total,
      byType: typeMap,
      byHorizon: horizonMap,
      recentPromotions,
      recentRollbacks,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let loggerInstance: ExchangeEventLoggerService | null = null;

export function getExchangeEventLoggerService(db: Db): ExchangeEventLoggerService {
  if (!loggerInstance) {
    loggerInstance = new ExchangeEventLoggerService(db);
  }
  return loggerInstance;
}

console.log('[Exchange ML] Event logger service loaded');
