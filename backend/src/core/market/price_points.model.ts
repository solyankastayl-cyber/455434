/**
 * Price Points Model (Phase 14A.1)
 * 
 * Time-series of token prices.
 * Minute-bucketed for efficient storage and queries.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type PriceSource = 'dex_v2' | 'dex_v3' | 'derived' | 'oracle' | 'manual';

export interface IPricePoint extends Document {
  _id: Types.ObjectId;
  
  // Asset identification
  chain: string;
  assetAddress: string;
  
  // Timestamp (minute-bucketed)
  timestamp: Date;                // Rounded to minute
  
  // Prices
  priceUsd: string;               // String for BigInt precision
  priceEth: string;               // String for BigInt precision
  
  // Source info
  source: PriceSource;
  sourcePairAddress?: string;     // Which DEX pair was used
  
  // Confidence (0-1)
  confidence: number;
  
  // Raw data for debugging
  rawData?: {
    reserve0?: string;
    reserve1?: string;
    sqrtPriceX96?: string;        // For V3
  };
  
  createdAt: Date;
}

const RawDataSchema = new Schema(
  {
    reserve0: String,
    reserve1: String,
    sqrtPriceX96: String,
  },
  { _id: false }
);

const PricePointSchema = new Schema<IPricePoint>(
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
    
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    
    priceUsd: {
      type: String,
      required: true,
    },
    priceEth: {
      type: String,
      required: true,
    },
    
    source: {
      type: String,
      enum: ['dex_v2', 'dex_v3', 'derived', 'oracle', 'manual'],
      required: true,
    },
    sourcePairAddress: {
      type: String,
      lowercase: true,
    },
    
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },
    
    rawData: RawDataSchema,
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'price_points',
  }
);

// Compound indexes for efficient queries
PricePointSchema.index({ assetAddress: 1, timestamp: -1 });
PricePointSchema.index({ chain: 1, assetAddress: 1, timestamp: -1 });
PricePointSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // TTL: 90 days

export const PricePointModel = mongoose.model<IPricePoint>('PricePoint', PricePointSchema);

/**
 * Round timestamp to minute bucket
 */
export function toMinuteBucket(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

/**
 * Parse price string to number (for calculations)
 * Handles BigInt-like strings
 */
export function parsePrice(priceStr: string): number {
  return parseFloat(priceStr);
}

/**
 * Format number to price string (for storage)
 * Preserves precision
 */
export function formatPrice(price: number): string {
  // Use toPrecision for very small/large numbers
  if (price === 0) return '0';
  if (Math.abs(price) < 0.000001) return price.toExponential(18);
  if (Math.abs(price) > 1e12) return price.toExponential(18);
  return price.toString();
}
