/**
 * TA Patterns Model - Mongoose schema for detected patterns
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ITaPattern extends Document {
  patternId: string;
  asset: string;
  timeframe: string;
  patternType: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  entryPrice: number;
  targetPrice?: number;
  stopPrice?: number;
  pivots: Array<{
    type: 'HIGH' | 'LOW';
    price: number;
    ts: number;
    index: number;
  }>;
  detectedAt: Date;
  expiresAt?: Date;
  status: 'ACTIVE' | 'TRIGGERED' | 'EXPIRED' | 'INVALIDATED';
  metadata?: Record<string, any>;
}

const TaPatternSchema = new Schema<ITaPattern>({
  patternId: { type: String, required: true, unique: true },
  asset: { type: String, required: true, index: true },
  timeframe: { type: String, required: true },
  patternType: { type: String, required: true, index: true },
  direction: { type: String, enum: ['BULLISH', 'BEARISH', 'NEUTRAL'], required: true },
  confidence: { type: Number, required: true },
  entryPrice: { type: Number, required: true },
  targetPrice: { type: Number },
  stopPrice: { type: Number },
  pivots: [{
    type: { type: String, enum: ['HIGH', 'LOW'] },
    price: Number,
    ts: Number,
    index: Number
  }],
  detectedAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date },
  status: { type: String, enum: ['ACTIVE', 'TRIGGERED', 'EXPIRED', 'INVALIDATED'], default: 'ACTIVE', index: true },
  metadata: { type: Schema.Types.Mixed }
}, {
  timestamps: true,
  collection: 'ta_patterns'
});

// Compound indexes
TaPatternSchema.index({ asset: 1, status: 1, detectedAt: -1 });
TaPatternSchema.index({ patternType: 1, asset: 1 });

export const TaPatternModel = mongoose.model<ITaPattern>('TaPattern', TaPatternSchema);
