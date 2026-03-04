/**
 * Market Candle Model (P1.5)
 * 
 * Stores OHLCV candles from market data sources.
 * This is RAW data - no signals, no decisions.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type MarketSource = 'coingecko' | 'binance' | 'bybit';
export type CandleInterval = '1m' | '5m' | '1h' | '4h' | '1d';

export interface IMarketCandle {
  source: MarketSource;
  symbol: string;          // ETH, ARB, OP, etc.
  pair?: string;           // ETH/USDT (if applicable)
  interval: CandleInterval;
  ts: number;              // Unix timestamp ms
  
  // OHLCV
  o: number;               // Open
  h: number;               // High
  l: number;               // Low
  c: number;               // Close
  v: number;               // Volume (base)
  vUsd?: number;           // Volume in USD (if available)
  quoteVolume?: number;    // Quote asset volume (P2.1 - Binance)
  trades?: number;         // Number of trades (P2.1 - Binance)
  
  // Metadata
  meta?: {
    exchange?: string;
    market?: string;
  };
  
  createdAt: Date;
}

export interface IMarketCandleDocument extends IMarketCandle, Document {}

// ============================================
// Schema
// ============================================

const MarketCandleSchema = new Schema<IMarketCandleDocument>({
  source: { 
    type: String, 
    required: true,
    enum: ['coingecko', 'binance', 'bybit'],
    index: true
  },
  symbol: { type: String, required: true, uppercase: true, index: true },
  pair: { type: String },
  interval: { 
    type: String, 
    required: true,
    enum: ['1m', '5m', '1h', '4h', '1d'],
    index: true
  },
  ts: { type: Number, required: true, index: true },
  
  o: { type: Number, required: true },
  h: { type: Number, required: true },
  l: { type: Number, required: true },
  c: { type: Number, required: true },
  v: { type: Number, required: true },
  vUsd: { type: Number },
  quoteVolume: { type: Number },  // P2.1: Binance quote volume
  trades: { type: Number },       // P2.1: Binance trade count
  
  meta: {
    exchange: { type: String },
    market: { type: String }
  },
  
  createdAt: { type: Date, default: Date.now }
}, {
  collection: 'market_candles'
});

// ============================================
// Indexes
// ============================================

// Unique constraint: one candle per source/symbol/interval/timestamp
MarketCandleSchema.index(
  { source: 1, symbol: 1, interval: 1, ts: 1 }, 
  { unique: true }
);

// Query patterns
MarketCandleSchema.index({ symbol: 1, interval: 1, ts: -1 });
MarketCandleSchema.index({ ts: -1 });

// TTL: expire candles older than 90 days for 1m interval
MarketCandleSchema.index(
  { createdAt: 1 }, 
  { 
    expireAfterSeconds: 90 * 24 * 60 * 60,
    partialFilterExpression: { interval: '1m' }
  }
);

// ============================================
// Model
// ============================================

export const MarketCandleModel = mongoose.model<IMarketCandleDocument>(
  'market_candles',
  MarketCandleSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Upsert candles (bulk)
 */
export async function upsertCandles(candles: IMarketCandle[]): Promise<number> {
  if (candles.length === 0) return 0;
  
  const operations = candles.map(c => ({
    updateOne: {
      filter: { source: c.source, symbol: c.symbol, interval: c.interval, ts: c.ts },
      update: { $set: c },
      upsert: true
    }
  }));
  
  const result = await MarketCandleModel.bulkWrite(operations, { ordered: false });
  return result.upsertedCount + result.modifiedCount;
}

/**
 * Get candles for symbol
 */
export async function getCandles(
  symbol: string,
  interval: CandleInterval,
  fromTs: number,
  toTs: number,
  source?: MarketSource,
  limit: number = 1000
): Promise<IMarketCandleDocument[]> {
  const query: any = {
    symbol: symbol.toUpperCase(),
    interval,
    ts: { $gte: fromTs, $lte: toTs }
  };
  
  if (source) {
    query.source = source;
  }
  
  return MarketCandleModel.find(query)
    .sort({ ts: 1 })
    .limit(limit)
    .lean();
}

/**
 * Get latest candle
 */
export async function getLatestCandle(
  symbol: string,
  interval: CandleInterval,
  source?: MarketSource
): Promise<IMarketCandleDocument | null> {
  const query: any = {
    symbol: symbol.toUpperCase(),
    interval
  };
  
  if (source) {
    query.source = source;
  }
  
  return MarketCandleModel.findOne(query)
    .sort({ ts: -1 })
    .lean();
}

/**
 * Get candle count
 */
export async function getCandleCount(
  symbol?: string,
  interval?: CandleInterval
): Promise<number> {
  const query: any = {};
  if (symbol) query.symbol = symbol.toUpperCase();
  if (interval) query.interval = interval;
  
  return MarketCandleModel.countDocuments(query);
}

/**
 * Get available symbols
 */
export async function getAvailableSymbols(): Promise<string[]> {
  return MarketCandleModel.distinct('symbol');
}
