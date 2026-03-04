/**
 * Market Metric Model (P1.5)
 * 
 * Stores pre-computed aggregates: volatility, volume z-score, regime.
 * These are CONTEXT, not signals.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type MetricWindow = '1h' | '24h' | '7d';
export type MarketRegime = 'CALM' | 'VOLATILE' | 'STRESSED';

export interface IMarketMetric {
  symbol: string;
  interval: string;      // Source candle interval
  window: MetricWindow;
  ts: number;            // Bucket timestamp (start of window)
  
  // Volatility
  volatility: number;    // Standard deviation of returns
  volatilityPct: number; // As percentage
  
  // Volume stats
  volumeMean: number;
  volumeStd: number;
  volumeZ: number;       // Current volume z-score (clamped -3..+3)
  volumeTotal: number;
  
  // Price
  priceChangePct: number;
  priceHigh: number;
  priceLow: number;
  priceOpen: number;
  priceClose: number;
  
  // Regime classification (rules-only, no ML)
  regime: MarketRegime;
  regimeScore: number;   // 0-100
  
  // Quality
  candleCount: number;
  qualityScore: number;  // 0-100
  
  createdAt: Date;
  updatedAt: Date;
}

export interface IMarketMetricDocument extends IMarketMetric, Document {}

// ============================================
// Schema
// ============================================

const MarketMetricSchema = new Schema<IMarketMetricDocument>({
  symbol: { type: String, required: true, uppercase: true, index: true },
  interval: { type: String, required: true },
  window: { 
    type: String, 
    required: true,
    enum: ['1h', '24h', '7d'],
    index: true
  },
  ts: { type: Number, required: true, index: true },
  
  volatility: { type: Number, required: true },
  volatilityPct: { type: Number, required: true },
  
  volumeMean: { type: Number, required: true },
  volumeStd: { type: Number, required: true },
  volumeZ: { type: Number, required: true },
  volumeTotal: { type: Number, required: true },
  
  priceChangePct: { type: Number, required: true },
  priceHigh: { type: Number, required: true },
  priceLow: { type: Number, required: true },
  priceOpen: { type: Number, required: true },
  priceClose: { type: Number, required: true },
  
  regime: { 
    type: String, 
    required: true,
    enum: ['CALM', 'VOLATILE', 'STRESSED'],
    index: true
  },
  regimeScore: { type: Number, required: true },
  
  candleCount: { type: Number, required: true },
  qualityScore: { type: Number, required: true },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  collection: 'market_data_metrics'
});

// ============================================
// Indexes
// ============================================

MarketMetricSchema.index(
  { symbol: 1, interval: 1, window: 1, ts: 1 }, 
  { unique: true }
);
MarketMetricSchema.index({ symbol: 1, window: 1, ts: -1 });
MarketMetricSchema.index({ regime: 1, ts: -1 });

// ============================================
// Model
// ============================================

export const MarketMetricModel = mongoose.model<IMarketMetricDocument>(
  'market_data_metrics',
  MarketMetricSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Upsert metric
 */
export async function upsertMetric(metric: IMarketMetric): Promise<IMarketMetricDocument> {
  return MarketMetricModel.findOneAndUpdate(
    { symbol: metric.symbol, interval: metric.interval, window: metric.window, ts: metric.ts },
    { $set: { ...metric, updatedAt: new Date() } },
    { upsert: true, new: true }
  ).lean();
}

/**
 * Get latest metric for symbol
 */
export async function getLatestMetric(
  symbol: string,
  window: MetricWindow
): Promise<IMarketMetricDocument | null> {
  return MarketMetricModel.findOne({
    symbol: symbol.toUpperCase(),
    window
  })
  .sort({ ts: -1 })
  .lean();
}

/**
 * Get metrics history
 */
export async function getMetricsHistory(
  symbol: string,
  window: MetricWindow,
  limit: number = 24
): Promise<IMarketMetricDocument[]> {
  return MarketMetricModel.find({
    symbol: symbol.toUpperCase(),
    window
  })
  .sort({ ts: -1 })
  .limit(limit)
  .lean();
}

/**
 * Get regime distribution
 */
export async function getRegimeDistribution(
  symbol: string,
  since?: Date
): Promise<Record<MarketRegime, number>> {
  const query: any = { symbol: symbol.toUpperCase() };
  if (since) {
    query.createdAt = { $gte: since };
  }
  
  const result = await MarketMetricModel.aggregate([
    { $match: query },
    { $group: { _id: '$regime', count: { $sum: 1 } } }
  ]);
  
  const distribution: Record<MarketRegime, number> = {
    CALM: 0,
    VOLATILE: 0,
    STRESSED: 0
  };
  
  for (const r of result) {
    distribution[r._id as MarketRegime] = r.count;
  }
  
  return distribution;
}
