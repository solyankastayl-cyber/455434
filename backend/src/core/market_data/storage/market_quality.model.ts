/**
 * Market Quality Model (P1.5)
 * 
 * Tracks data quality for gates integration.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export interface IMarketQuality {
  symbol: string;
  interval: string;
  
  // Coverage (what % of expected candles do we have)
  coveragePct24h: number;
  coveragePct7d: number;
  
  // Freshness
  lastCandleTs: number;
  freshnessLagMin: number;
  
  // Quality score (0-100)
  qualityScore: number;
  
  // Gate status
  gateStatus: 'PASS' | 'WARN' | 'FAIL';
  blockedReason?: string;
  
  // Stats
  totalCandles24h: number;
  expectedCandles24h: number;
  gapCount24h: number;
  
  updatedAt: Date;
}

export interface IMarketQualityDocument extends IMarketQuality, Document {}

// ============================================
// Schema
// ============================================

const MarketQualitySchema = new Schema<IMarketQualityDocument>({
  symbol: { type: String, required: true, uppercase: true },
  interval: { type: String, required: true },
  
  coveragePct24h: { type: Number, required: true },
  coveragePct7d: { type: Number, required: true },
  
  lastCandleTs: { type: Number, required: true },
  freshnessLagMin: { type: Number, required: true },
  
  qualityScore: { type: Number, required: true },
  
  gateStatus: { 
    type: String, 
    required: true,
    enum: ['PASS', 'WARN', 'FAIL'],
    index: true
  },
  blockedReason: { type: String },
  
  totalCandles24h: { type: Number, required: true },
  expectedCandles24h: { type: Number, required: true },
  gapCount24h: { type: Number, required: true },
  
  updatedAt: { type: Date, default: Date.now, index: true }
}, {
  collection: 'market_quality'
});

// ============================================
// Indexes
// ============================================

MarketQualitySchema.index({ symbol: 1, interval: 1 }, { unique: true });
MarketQualitySchema.index({ qualityScore: 1 });

// ============================================
// Model
// ============================================

export const MarketQualityModel = mongoose.model<IMarketQualityDocument>(
  'market_quality',
  MarketQualitySchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Upsert quality record
 */
export async function upsertQuality(quality: IMarketQuality): Promise<IMarketQualityDocument> {
  return MarketQualityModel.findOneAndUpdate(
    { symbol: quality.symbol.toUpperCase(), interval: quality.interval },
    { $set: { ...quality, updatedAt: new Date() } },
    { upsert: true, new: true }
  ).lean();
}

/**
 * Get quality for symbol
 */
export async function getQuality(
  symbol: string,
  interval: string
): Promise<IMarketQualityDocument | null> {
  return MarketQualityModel.findOne({
    symbol: symbol.toUpperCase(),
    interval
  }).lean();
}

/**
 * Get all quality records
 */
export async function getAllQuality(): Promise<IMarketQualityDocument[]> {
  return MarketQualityModel.find({}).sort({ symbol: 1, interval: 1 }).lean();
}

/**
 * Get quality summary
 */
export async function getQualitySummary(): Promise<{
  totalSymbols: number;
  byGateStatus: Record<string, number>;
  avgQualityScore: number;
  avgCoverage: number;
  avgFreshnessLag: number;
}> {
  const [total, byStatus, avgMetrics] = await Promise.all([
    MarketQualityModel.countDocuments(),
    MarketQualityModel.aggregate([
      { $group: { _id: '$gateStatus', count: { $sum: 1 } } }
    ]),
    MarketQualityModel.aggregate([
      {
        $group: {
          _id: null,
          avgQuality: { $avg: '$qualityScore' },
          avgCoverage: { $avg: '$coveragePct24h' },
          avgLag: { $avg: '$freshnessLagMin' }
        }
      }
    ])
  ]);
  
  const metrics = avgMetrics[0] || { avgQuality: 0, avgCoverage: 0, avgLag: 0 };
  
  return {
    totalSymbols: total,
    byGateStatus: byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {} as Record<string, number>),
    avgQualityScore: Math.round(metrics.avgQuality || 0),
    avgCoverage: Math.round(metrics.avgCoverage || 0),
    avgFreshnessLag: Math.round(metrics.avgLag || 0)
  };
}
