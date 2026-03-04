/**
 * S10.1 — Exchange MongoDB Models
 */

import mongoose, { Schema, Document } from 'mongoose';
import {
  ExchangeMarketSnapshot,
  OrderBookSnapshot,
  TradeFlowSnapshot,
  OpenInterestSnapshot,
  LiquidationEvent,
  ExchangeConfig,
} from './exchange.types.js';

// ═══════════════════════════════════════════════════════════════
// MARKET SNAPSHOT MODEL
// ═══════════════════════════════════════════════════════════════
const ExchangeMarketSnapshotSchema = new Schema<ExchangeMarketSnapshot & Document>({
  symbol: { type: String, required: true, index: true },
  price: { type: Number, required: true },
  change24h: { type: Number, default: 0 },
  volume24h: { type: Number, default: 0 },
  volatility: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

ExchangeMarketSnapshotSchema.index({ symbol: 1, timestamp: -1 });

export const ExchangeMarketModel = mongoose.model('ExchangeMarketSnapshot', ExchangeMarketSnapshotSchema);

// ═══════════════════════════════════════════════════════════════
// ORDER BOOK SNAPSHOT MODEL
// ═══════════════════════════════════════════════════════════════
const OrderBookSnapshotSchema = new Schema<OrderBookSnapshot & Document>({
  symbol: { type: String, required: true, index: true },
  bids: [{ price: Number, quantity: Number }],
  asks: [{ price: Number, quantity: Number }],
  spread: { type: Number, default: 0 },
  imbalance: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

OrderBookSnapshotSchema.index({ symbol: 1, timestamp: -1 });

export const OrderBookModel = mongoose.model('OrderBookSnapshot', OrderBookSnapshotSchema);

// ═══════════════════════════════════════════════════════════════
// TRADE FLOW SNAPSHOT MODEL
// ═══════════════════════════════════════════════════════════════
const TradeFlowSnapshotSchema = new Schema<TradeFlowSnapshot & Document>({
  symbol: { type: String, required: true, index: true },
  buyVolume: { type: Number, default: 0 },
  sellVolume: { type: Number, default: 0 },
  aggressorRatio: { type: Number, default: 0 },
  window: { type: String, default: '5m' },
  timestamp: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

TradeFlowSnapshotSchema.index({ symbol: 1, timestamp: -1 });

export const TradeFlowModel = mongoose.model('TradeFlowSnapshot', TradeFlowSnapshotSchema);

// ═══════════════════════════════════════════════════════════════
// OPEN INTEREST SNAPSHOT MODEL
// ═══════════════════════════════════════════════════════════════
const OpenInterestSnapshotSchema = new Schema<OpenInterestSnapshot & Document>({
  symbol: { type: String, required: true, index: true },
  oi: { type: Number, default: 0 },
  oiChange: { type: Number, default: 0 },
  fundingRate: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

OpenInterestSnapshotSchema.index({ symbol: 1, timestamp: -1 });

export const OpenInterestModel = mongoose.model('OpenInterestSnapshot', OpenInterestSnapshotSchema);

// ═══════════════════════════════════════════════════════════════
// LIQUIDATION EVENT MODEL
// ═══════════════════════════════════════════════════════════════
const LiquidationEventSchema = new Schema<LiquidationEvent & Document>({
  symbol: { type: String, required: true, index: true },
  side: { type: String, enum: ['LONG', 'SHORT'], required: true },
  size: { type: Number, required: true },
  price: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

LiquidationEventSchema.index({ symbol: 1, timestamp: -1 });
LiquidationEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 * 7 }); // 7 days TTL

export const LiquidationModel = mongoose.model('LiquidationEvent', LiquidationEventSchema);

// ═══════════════════════════════════════════════════════════════
// EXCHANGE CONFIG MODEL
// ═══════════════════════════════════════════════════════════════
const ExchangeConfigSchema = new Schema<ExchangeConfig & Document>({
  enabled: { type: Boolean, default: false },
  pollingIntervalMs: { type: Number, default: 30000 },
  symbols: [{ type: String }],
  provider: { type: String, default: 'binance' },
}, { timestamps: true });

export const ExchangeConfigModel = mongoose.model('ExchangeConfig', ExchangeConfigSchema);

// ═══════════════════════════════════════════════════════════════
// PROVIDER STATUS MODEL (in-memory cache, no persistence)
// ═══════════════════════════════════════════════════════════════
export interface ProviderStatusCache {
  provider: string;
  status: 'OK' | 'DEGRADED' | 'DOWN';
  lastUpdate: Date;
  errorCount: number;
  rateLimitUsed: number;
  latencyMs: number;
}

// In-memory cache for provider status
export const providerStatusCache: Map<string, ProviderStatusCache> = new Map();
