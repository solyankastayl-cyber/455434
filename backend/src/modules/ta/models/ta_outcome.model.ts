/**
 * TA Outcomes Model - Mongoose schema for pattern outcomes
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ITaOutcome extends Document {
  outcomeId: string;
  patternId: string;
  asset: string;
  patternType: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  entryPrice: number;
  targetPrice?: number;
  stopPrice?: number;
  
  // Outcome data
  result: 'WIN' | 'LOSS' | 'PARTIAL' | 'PENDING';
  exitPrice?: number;
  returnPct?: number;
  maxDrawdown?: number;
  maxRunup?: number;
  duration?: number; // in hours
  
  // Timing
  entryTime: Date;
  exitTime?: Date;
  evaluatedAt?: Date;
  
  // Attribution
  confidenceAtEntry: number;
  mlScoreAtEntry?: number;
  marketRegime?: string;
  volatilityAtEntry?: number;
  
  metadata?: Record<string, any>;
}

const TaOutcomeSchema = new Schema<ITaOutcome>({
  outcomeId: { type: String, required: true, unique: true },
  patternId: { type: String, required: true, index: true },
  asset: { type: String, required: true, index: true },
  patternType: { type: String, required: true, index: true },
  direction: { type: String, enum: ['BULLISH', 'BEARISH', 'NEUTRAL'], required: true },
  entryPrice: { type: Number, required: true },
  targetPrice: { type: Number },
  stopPrice: { type: Number },
  
  result: { type: String, enum: ['WIN', 'LOSS', 'PARTIAL', 'PENDING'], default: 'PENDING', index: true },
  exitPrice: { type: Number },
  returnPct: { type: Number },
  maxDrawdown: { type: Number },
  maxRunup: { type: Number },
  duration: { type: Number },
  
  entryTime: { type: Date, required: true },
  exitTime: { type: Date },
  evaluatedAt: { type: Date },
  
  confidenceAtEntry: { type: Number, required: true },
  mlScoreAtEntry: { type: Number },
  marketRegime: { type: String },
  volatilityAtEntry: { type: Number },
  
  metadata: { type: Schema.Types.Mixed }
}, {
  timestamps: true,
  collection: 'ta_outcomes'
});

// Compound indexes
TaOutcomeSchema.index({ asset: 1, result: 1, entryTime: -1 });
TaOutcomeSchema.index({ patternType: 1, result: 1 });
TaOutcomeSchema.index({ result: 1, evaluatedAt: -1 });

export const TaOutcomeModel = mongoose.model<ITaOutcome>('TaOutcome', TaOutcomeSchema);
