/**
 * Market Regimes Model (Phase 14C.1)
 * 
 * Tracks market context/regime for assets.
 * Helps explain why signals succeed or fail.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type RegimeTimeframe = '1h' | '4h' | '1d';
export type MarketRegime = 'trend_up' | 'trend_down' | 'range' | 'high_volatility' | 'low_liquidity';

export interface IMarketRegime extends Document {
  _id: Types.ObjectId;
  
  // Asset identification
  assetAddress: string;
  chain: string;
  
  // Timeframe
  timeframe: RegimeTimeframe;
  
  // Regime classification
  regime: MarketRegime;
  regimeConfidence: number;        // 0-1 confidence in regime classification
  
  // Underlying metrics
  volatility: number;              // Annualized volatility
  trendStrength: number;           // 0-1 trend strength (R² of price regression)
  trendDirection: number;          // Slope: positive = up, negative = down
  priceChangePercent: number;      // Price change in timeframe
  maxDrawdownPercent: number;      // Max drawdown in timeframe
  
  // Thresholds used
  volatilityThreshold: number;     // Above this = high_volatility
  trendThreshold: number;          // Above this = trend
  
  // Validity
  computedAt: Date;
  validUntil: Date;
  
  // Previous regime (for regime change detection)
  previousRegime?: MarketRegime;
  regimeChanged: boolean;
  
  createdAt: Date;
  updatedAt: Date;
}

const MarketRegimeSchema = new Schema<IMarketRegime>(
  {
    assetAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    chain: {
      type: String,
      required: true,
      default: 'ethereum',
    },
    
    timeframe: {
      type: String,
      enum: ['1h', '4h', '1d'],
      required: true,
      index: true,
    },
    
    regime: {
      type: String,
      enum: ['trend_up', 'trend_down', 'range', 'high_volatility', 'low_liquidity'],
      required: true,
      index: true,
    },
    regimeConfidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    
    volatility: { type: Number, required: true },
    trendStrength: { type: Number, required: true },
    trendDirection: { type: Number, required: true },
    priceChangePercent: { type: Number, required: true },
    maxDrawdownPercent: { type: Number, required: true },
    
    volatilityThreshold: { type: Number, default: 0.05 },
    trendThreshold: { type: Number, default: 0.4 },
    
    computedAt: { type: Date, required: true },
    validUntil: { type: Date, required: true, index: true },
    
    previousRegime: {
      type: String,
      enum: ['trend_up', 'trend_down', 'range', 'high_volatility', 'low_liquidity'],
    },
    regimeChanged: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'market_regimes',
  }
);

// Indexes
MarketRegimeSchema.index({ assetAddress: 1, timeframe: 1 }, { unique: true });
MarketRegimeSchema.index({ regime: 1, computedAt: -1 });
MarketRegimeSchema.index({ regimeChanged: 1, computedAt: -1 });

export const MarketRegimeModel = mongoose.model<IMarketRegime>(
  'MarketRegime',
  MarketRegimeSchema
);

/**
 * Regime detection thresholds
 */
export const REGIME_THRESHOLDS = {
  // High volatility threshold (annualized)
  highVolatility: 0.05,           // 5% = high volatility
  
  // Trend strength threshold
  strongTrend: 0.4,               // R² > 0.4 = trending
  
  // Minimum price change for trend
  minTrendMove: 1.0,              // 1% minimum move to be a trend
  
  // Validity periods (ms)
  validity: {
    '1h': 15 * 60 * 1000,         // 15 minutes
    '4h': 60 * 60 * 1000,         // 1 hour  
    '1d': 4 * 60 * 60 * 1000,     // 4 hours
  },
};

/**
 * Get timeframe duration in milliseconds
 */
export function getTimeframeMs(timeframe: RegimeTimeframe): number {
  const durations: Record<RegimeTimeframe, number> = {
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };
  return durations[timeframe];
}

/**
 * Get human-readable regime description
 */
export function getRegimeDescription(regime: MarketRegime): string {
  const descriptions: Record<MarketRegime, string> = {
    'trend_up': '📈 Uptrend - Price moving up with strong momentum',
    'trend_down': '📉 Downtrend - Price moving down with strong momentum',
    'range': '↔️ Range-bound - Price consolidating without clear direction',
    'high_volatility': '⚡ High Volatility - Large price swings, unpredictable',
    'low_liquidity': '💧 Low Liquidity - Thin markets, wide spreads',
  };
  return descriptions[regime];
}
