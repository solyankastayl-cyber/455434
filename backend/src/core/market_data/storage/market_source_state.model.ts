/**
 * Market Source State Model (P1.5)
 * 
 * Tracks ingestion progress, errors, and rate limits per source.
 */

import mongoose, { Schema, Document } from 'mongoose';
import { MarketSource, CandleInterval } from './market_candle.model.js';

// ============================================
// Types
// ============================================

export type SourceStatus = 'OK' | 'DEGRADED' | 'PAUSED' | 'ERROR';

export interface IRateLimitState {
  remainingRequests: number;
  resetAt: Date;
  isLimited: boolean;
}

export interface IMarketSourceState {
  source: MarketSource;
  symbol: string;
  interval: CandleInterval;
  
  // Progress
  lastSyncedTs: number;
  lastSyncedAt: Date;
  
  // Status
  status: SourceStatus;
  
  // Errors
  errorCount: number;
  lastError?: string;
  lastErrorAt?: Date;
  consecutiveErrors: number;
  
  // Rate limiting
  rateLimit?: IRateLimitState;
  
  // Stats
  totalCandles: number;
  syncCount: number;
  avgSyncDurationMs: number;
  
  createdAt: Date;
  updatedAt: Date;
}

export interface IMarketSourceStateDocument extends IMarketSourceState, Document {}

// ============================================
// Schema
// ============================================

const RateLimitSchema = new Schema<IRateLimitState>({
  remainingRequests: { type: Number },
  resetAt: { type: Date },
  isLimited: { type: Boolean, default: false }
}, { _id: false });

const MarketSourceStateSchema = new Schema<IMarketSourceStateDocument>({
  source: { 
    type: String, 
    required: true,
    enum: ['coingecko', 'binance', 'bybit']
  },
  symbol: { type: String, required: true, uppercase: true },
  interval: { 
    type: String, 
    required: true,
    enum: ['1m', '5m', '1h', '4h', '1d']
  },
  
  lastSyncedTs: { type: Number, default: 0 },
  lastSyncedAt: { type: Date },
  
  status: { 
    type: String, 
    required: true,
    enum: ['OK', 'DEGRADED', 'PAUSED', 'ERROR'],
    default: 'OK',
    index: true
  },
  
  errorCount: { type: Number, default: 0 },
  lastError: { type: String },
  lastErrorAt: { type: Date },
  consecutiveErrors: { type: Number, default: 0 },
  
  rateLimit: { type: RateLimitSchema },
  
  totalCandles: { type: Number, default: 0 },
  syncCount: { type: Number, default: 0 },
  avgSyncDurationMs: { type: Number, default: 0 },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  collection: 'market_source_states'
});

// ============================================
// Indexes
// ============================================

MarketSourceStateSchema.index(
  { source: 1, symbol: 1, interval: 1 }, 
  { unique: true }
);
MarketSourceStateSchema.index({ status: 1 });
MarketSourceStateSchema.index({ lastSyncedAt: -1 });

// ============================================
// Model
// ============================================

export const MarketSourceStateModel = mongoose.model<IMarketSourceStateDocument>(
  'market_source_states',
  MarketSourceStateSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Get or create source state
 */
export async function getOrCreateSourceState(
  source: MarketSource,
  symbol: string,
  interval: CandleInterval
): Promise<IMarketSourceStateDocument> {
  let state = await MarketSourceStateModel.findOne({
    source,
    symbol: symbol.toUpperCase(),
    interval
  });
  
  if (!state) {
    state = await MarketSourceStateModel.create({
      source,
      symbol: symbol.toUpperCase(),
      interval,
      status: 'OK',
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }
  
  return state;
}

/**
 * Update sync progress
 */
export async function updateSyncProgress(
  source: MarketSource,
  symbol: string,
  interval: CandleInterval,
  lastTs: number,
  candlesAdded: number,
  durationMs: number
): Promise<void> {
  await MarketSourceStateModel.updateOne(
    { source, symbol: symbol.toUpperCase(), interval },
    {
      $set: {
        lastSyncedTs: lastTs,
        lastSyncedAt: new Date(),
        status: 'OK',
        consecutiveErrors: 0,
        updatedAt: new Date()
      },
      $inc: {
        totalCandles: candlesAdded,
        syncCount: 1
      }
    },
    { upsert: true }
  );
}

/**
 * Record error
 */
export async function recordSyncError(
  source: MarketSource,
  symbol: string,
  interval: CandleInterval,
  error: string
): Promise<void> {
  const state = await getOrCreateSourceState(source, symbol, interval);
  const newConsecutive = state.consecutiveErrors + 1;
  
  // Degrade status after 3 consecutive errors
  const newStatus: SourceStatus = newConsecutive >= 5 
    ? 'ERROR' 
    : newConsecutive >= 3 
      ? 'DEGRADED' 
      : state.status;
  
  await MarketSourceStateModel.updateOne(
    { source, symbol: symbol.toUpperCase(), interval },
    {
      $set: {
        status: newStatus,
        lastError: error,
        lastErrorAt: new Date(),
        consecutiveErrors: newConsecutive,
        updatedAt: new Date()
      },
      $inc: { errorCount: 1 }
    }
  );
}

/**
 * Update rate limit state
 */
export async function updateRateLimit(
  source: MarketSource,
  rateLimit: IRateLimitState
): Promise<void> {
  await MarketSourceStateModel.updateMany(
    { source },
    { $set: { rateLimit, updatedAt: new Date() } }
  );
}

/**
 * Pause source
 */
export async function pauseSource(
  source: MarketSource,
  symbol?: string
): Promise<number> {
  const query: any = { source };
  if (symbol) query.symbol = symbol.toUpperCase();
  
  const result = await MarketSourceStateModel.updateMany(
    query,
    { $set: { status: 'PAUSED', updatedAt: new Date() } }
  );
  
  return result.modifiedCount;
}

/**
 * Resume source
 */
export async function resumeSource(
  source: MarketSource,
  symbol?: string
): Promise<number> {
  const query: any = { source, status: 'PAUSED' };
  if (symbol) query.symbol = symbol.toUpperCase();
  
  const result = await MarketSourceStateModel.updateMany(
    query,
    { $set: { status: 'OK', consecutiveErrors: 0, updatedAt: new Date() } }
  );
  
  return result.modifiedCount;
}

/**
 * Get all source states
 */
export async function getAllSourceStates(): Promise<IMarketSourceStateDocument[]> {
  return MarketSourceStateModel.find({}).sort({ source: 1, symbol: 1 }).lean();
}

/**
 * Get source health summary
 */
export async function getSourceHealthSummary(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  lastSync?: Date;
  errorCount: number;
}> {
  const [total, byStatus, bySource, lastSync, errors] = await Promise.all([
    MarketSourceStateModel.countDocuments(),
    MarketSourceStateModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    MarketSourceStateModel.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]),
    MarketSourceStateModel.findOne({}).sort({ lastSyncedAt: -1 }).select('lastSyncedAt'),
    MarketSourceStateModel.aggregate([
      { $group: { _id: null, total: { $sum: '$errorCount' } } }
    ])
  ]);
  
  return {
    total,
    byStatus: byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {} as Record<string, number>),
    bySource: bySource.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {} as Record<string, number>),
    lastSync: lastSync?.lastSyncedAt,
    errorCount: errors[0]?.total || 0
  };
}
