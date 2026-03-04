/**
 * Market API Source Model (P1.5.B)
 * 
 * Stores API source configurations for market data providers.
 * Enables runtime management of multiple API keys per provider.
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ============================================
// Types
// ============================================

export type MarketProvider = 'coingecko' | 'binance' | 'coinmarketcap';

export type MarketCapability = 'candles' | 'price' | 'volume' | 'market_context';

export type SourceStatus = 'active' | 'needs_key' | 'rate_limited' | 'error' | 'disabled';

export interface IMarketApiSource {
  provider: MarketProvider;
  label: string;
  apiKey?: string;
  apiSecret?: string;
  
  capabilities: MarketCapability[];
  
  limits: {
    rpm: number;        // requests per minute
    rpd?: number;       // requests per day (optional)
  };
  
  weight: number;       // 1-10, higher = preferred
  enabled: boolean;
  
  stats: {
    windowKey: number;         // minute window key for reset
    requestsMinute: number;    // requests in current minute
    rateLimitHits: number;     // total 429 responses
    errorCount: number;        // total errors
    lastUsedAt?: number;       // last request timestamp
    lastErrorAt?: number;      // last error timestamp
    lastError?: string;        // last error message
    avgLatencyMs?: number;     // average latency
  };
  
  createdAt: number;
  updatedAt: number;
}

export interface IMarketApiSourceDocument extends IMarketApiSource, Document {
  _id: mongoose.Types.ObjectId;
}

// ============================================
// Schema
// ============================================

const MarketApiSourceSchema = new Schema<IMarketApiSourceDocument>({
  provider: { 
    type: String, 
    required: true, 
    enum: ['coingecko', 'binance', 'coinmarketcap'],
    index: true 
  },
  label: { type: String, required: true },
  apiKey: { type: String, default: null },
  apiSecret: { type: String, default: null },
  
  capabilities: { 
    type: [String], 
    default: ['candles', 'price', 'volume'],
    enum: ['candles', 'price', 'volume', 'market_context']
  },
  
  limits: {
    rpm: { type: Number, required: true, default: 30 },
    rpd: { type: Number, default: null }
  },
  
  weight: { type: Number, required: true, default: 5, min: 1, max: 10 },
  enabled: { type: Boolean, required: true, default: true },
  
  stats: {
    windowKey: { type: Number, default: 0 },
    requestsMinute: { type: Number, default: 0 },
    rateLimitHits: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    lastUsedAt: { type: Number, default: null },
    lastErrorAt: { type: Number, default: null },
    lastError: { type: String, default: null },
    avgLatencyMs: { type: Number, default: null }
  },
  
  createdAt: { type: Number, required: true },
  updatedAt: { type: Number, required: true }
}, {
  collection: 'market_api_sources'
});

// Indexes
MarketApiSourceSchema.index({ provider: 1, enabled: 1 });
MarketApiSourceSchema.index({ provider: 1, weight: -1 });
MarketApiSourceSchema.index({ updatedAt: -1 });

// ============================================
// Model
// ============================================

export const MarketApiSourceModel: Model<IMarketApiSourceDocument> = 
  mongoose.models.MarketApiSource || 
  mongoose.model<IMarketApiSourceDocument>('MarketApiSource', MarketApiSourceSchema);

// ============================================
// Helper Functions
// ============================================

/**
 * Get current minute window key
 */
export function getMinuteKey(ts = Date.now()): number {
  return Math.floor(ts / 60000);
}

/**
 * Mask API key for display (show last 4 chars)
 */
export function maskApiKey(key?: string | null): string {
  if (!key) return '';
  if (key.length <= 4) return '****';
  return '****' + key.slice(-4);
}

/**
 * Get source status based on stats
 */
export function getSourceStatus(source: IMarketApiSource): SourceStatus {
  if (!source.enabled) return 'disabled';
  
  // Check if key is required but missing
  if (source.provider === 'coinmarketcap' && !source.apiKey) {
    return 'needs_key';
  }
  
  // Check recent errors
  if (source.stats.rateLimitHits > 10 && source.stats.lastErrorAt) {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    if (source.stats.lastErrorAt > hourAgo) {
      return 'rate_limited';
    }
  }
  
  if (source.stats.errorCount > 5 && source.stats.lastErrorAt) {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    if (source.stats.lastErrorAt > hourAgo) {
      return 'error';
    }
  }
  
  return 'active';
}

/**
 * Create a source DTO safe for frontend (masked keys)
 */
export function toSafeSourceDTO(source: IMarketApiSourceDocument) {
  return {
    _id: source._id.toString(),
    provider: source.provider,
    label: source.label,
    apiKey: maskApiKey(source.apiKey),
    hasApiSecret: !!source.apiSecret,
    limits: source.limits,
    weight: source.weight,
    enabled: source.enabled,
    stats: source.stats,
    status: getSourceStatus(source),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt
  };
}

// ============================================
// CRUD Operations
// ============================================

export async function createSource(data: Partial<IMarketApiSource>): Promise<IMarketApiSourceDocument> {
  const now = Date.now();
  const source = new MarketApiSourceModel({
    ...data,
    stats: {
      windowKey: getMinuteKey(),
      requestsMinute: 0,
      rateLimitHits: 0,
      errorCount: 0
    },
    createdAt: now,
    updatedAt: now
  });
  return source.save();
}

export async function updateSource(
  id: string, 
  data: Partial<IMarketApiSource>
): Promise<IMarketApiSourceDocument | null> {
  return MarketApiSourceModel.findByIdAndUpdate(
    id,
    { ...data, updatedAt: Date.now() },
    { new: true }
  );
}

export async function deleteSource(id: string): Promise<boolean> {
  const result = await MarketApiSourceModel.deleteOne({ _id: id });
  return result.deletedCount > 0;
}

export async function getSourceById(id: string): Promise<IMarketApiSourceDocument | null> {
  return MarketApiSourceModel.findById(id);
}

export async function getAllSources(): Promise<IMarketApiSourceDocument[]> {
  return MarketApiSourceModel.find().sort({ provider: 1, weight: -1 });
}

export async function getSourcesByProvider(
  provider: MarketProvider, 
  enabledOnly = true
): Promise<IMarketApiSourceDocument[]> {
  const query: any = { provider };
  if (enabledOnly) query.enabled = true;
  return MarketApiSourceModel.find(query).sort({ weight: -1 });
}
