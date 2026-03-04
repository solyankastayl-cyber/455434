/**
 * Market Metrics Model (Phase 14A.2)
 * 
 * Aggregated market metrics by asset and time window.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type MetricsWindow = '1h' | '4h' | '24h' | '7d';

export interface IMarketMetrics extends Document {
  _id: Types.ObjectId;
  
  // Asset identification
  chain: string;
  assetAddress: string;
  
  // Time window
  window: MetricsWindow;
  calculatedAt: Date;
  validUntil: Date;
  
  // Price metrics
  priceStart: string;
  priceEnd: string;
  priceHigh: string;
  priceLow: string;
  priceChange: number;            // Percentage
  
  // Volatility
  volatility: number;             // std(log returns)
  volatilityRank?: number;        // 0-100 percentile
  
  // Trend
  trend: number;                  // slope(ln(price)), positive = up
  trendStrength: number;          // R² of trend fit
  
  // Drawdown
  maxDrawdown: number;            // Max peak-to-trough in window
  
  // Liquidity
  liquidityScore: number;         // 0-1
  avgTvlUsd?: number;
  
  // Confidence
  priceConfidenceAvg: number;     // Average confidence of price points
  dataPointsCount: number;        // How many price points in window
  
  createdAt: Date;
  updatedAt: Date;
}

const MarketMetricsSchema = new Schema<IMarketMetrics>(
  {
    chain: {
      type: String,
      required: true,
      index: true,
    },
    assetAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    window: {
      type: String,
      enum: ['1h', '4h', '24h', '7d'],
      required: true,
      index: true,
    },
    calculatedAt: {
      type: Date,
      required: true,
    },
    validUntil: {
      type: Date,
      required: true,
      index: true,
    },
    
    priceStart: { type: String, required: true },
    priceEnd: { type: String, required: true },
    priceHigh: { type: String, required: true },
    priceLow: { type: String, required: true },
    priceChange: { type: Number, required: true },
    
    volatility: { type: Number, required: true },
    volatilityRank: Number,
    
    trend: { type: Number, required: true },
    trendStrength: { type: Number, default: 0 },
    
    maxDrawdown: { type: Number, required: true },
    
    liquidityScore: { type: Number, required: true },
    avgTvlUsd: Number,
    
    priceConfidenceAvg: { type: Number, required: true },
    dataPointsCount: { type: Number, required: true },
  },
  {
    timestamps: true,
    collection: 'market_metrics',
  }
);

// Compound indexes
MarketMetricsSchema.index({ assetAddress: 1, window: 1 }, { unique: true });
MarketMetricsSchema.index({ window: 1, volatility: -1 });
MarketMetricsSchema.index({ window: 1, trend: -1 });
MarketMetricsSchema.index({ window: 1, liquidityScore: -1 });

export const MarketMetricsModel = mongoose.model<IMarketMetrics>('MarketMetrics', MarketMetricsSchema);

/**
 * Get window duration in milliseconds
 */
export function getWindowMs(window: MetricsWindow): number {
  const durations: Record<MetricsWindow, number> = {
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };
  return durations[window];
}

/**
 * Get validity duration for metrics
 */
export function getValidityMs(window: MetricsWindow): number {
  const validity: Record<MetricsWindow, number> = {
    '1h': 5 * 60 * 1000,      // Valid for 5 minutes
    '4h': 15 * 60 * 1000,     // Valid for 15 minutes
    '24h': 60 * 60 * 1000,    // Valid for 1 hour
    '7d': 4 * 60 * 60 * 1000, // Valid for 4 hours
  };
  return validity[window];
}
