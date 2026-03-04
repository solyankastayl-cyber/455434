/**
 * PHASE 4 - БЛОК 4.4: Price Outcomes Model
 * 
 * Stores price movements at different time horizons
 * Used ONLY for outcome labels in Shadow ML
 * 
 * NEVER used in Engine decisions
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IPriceOutcome extends Document {
  tokenId: string;
  symbol: string;
  
  // Base timestamp (signal/decision time)
  t0: Date;
  price0: number;
  
  // 24h outcome
  outcome24h?: {
    timestamp: Date;
    price: number;
    returnPct: number;
    label: 'UP' | 'DOWN' | 'FLAT';
  };
  
  // 7d outcome
  outcome7d?: {
    timestamp: Date;
    price: number;
    returnPct: number;
    label: 'UP' | 'DOWN' | 'FLAT';
  };
  
  // Source
  source: string; // 'coingecko' | 'onchain'
  verified: boolean;
  
  // Metadata
  signalId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PriceOutcomeSchema = new Schema<IPriceOutcome>(
  {
    tokenId: { type: String, required: true, index: true },
    symbol: { type: String, required: true },
    
    t0: { type: Date, required: true, index: true },
    price0: { type: Number, required: true },
    
    outcome24h: {
      timestamp: Date,
      price: Number,
      returnPct: Number,
      label: { type: String, enum: ['UP', 'DOWN', 'FLAT'] },
    },
    
    outcome7d: {
      timestamp: Date,
      price: Number,
      returnPct: Number,
      label: { type: String, enum: ['UP', 'DOWN', 'FLAT'] },
    },
    
    source: { type: String, required: true, default: 'coingecko' },
    verified: { type: Boolean, default: false },
    
    signalId: { type: String, index: true },
  },
  {
    timestamps: true,
    collection: 'price_outcomes',
  }
);

// Compound indexes for efficient queries
PriceOutcomeSchema.index({ tokenId: 1, t0: 1 }, { unique: true });
PriceOutcomeSchema.index({ signalId: 1 });
PriceOutcomeSchema.index({ 'outcome24h.label': 1 });
PriceOutcomeSchema.index({ 'outcome7d.label': 1 });

export const PriceOutcomeModel = mongoose.model<IPriceOutcome>('PriceOutcome', PriceOutcomeSchema);
