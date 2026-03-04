/**
 * TA Decisions Model - Mongoose schema for trading decisions
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ITaDecision extends Document {
  decisionId: string;
  asset: string;
  timeframe: string;
  
  // Decision
  action: 'LONG' | 'SHORT' | 'HOLD' | 'EXIT';
  confidence: number;
  
  // Supporting data
  primaryScenario: {
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    entryPrice: number;
    targetPrice: number;
    stopPrice: number;
    riskReward: number;
    patterns: string[];
  };
  
  alternativeScenarios?: Array<{
    direction: string;
    confidence: number;
    summary: string;
  }>;
  
  // Context
  marketStructure: {
    trend: string;
    strength: number;
  };
  
  keyLevels: Array<{
    price: number;
    type: 'SUPPORT' | 'RESISTANCE';
    strength: number;
  }>;
  
  volatility?: {
    atrPct: number;
    regime: string;
  };
  
  // ML
  mlScore?: number;
  
  // Timing
  generatedAt: Date;
  validUntil?: Date;
  
  metadata?: Record<string, any>;
}

const TaDecisionSchema = new Schema<ITaDecision>({
  decisionId: { type: String, required: true, unique: true },
  asset: { type: String, required: true, index: true },
  timeframe: { type: String, required: true },
  
  action: { type: String, enum: ['LONG', 'SHORT', 'HOLD', 'EXIT'], required: true },
  confidence: { type: Number, required: true },
  
  primaryScenario: {
    direction: { type: String, enum: ['LONG', 'SHORT', 'NEUTRAL'] },
    entryPrice: Number,
    targetPrice: Number,
    stopPrice: Number,
    riskReward: Number,
    patterns: [String]
  },
  
  alternativeScenarios: [{
    direction: String,
    confidence: Number,
    summary: String
  }],
  
  marketStructure: {
    trend: String,
    strength: Number
  },
  
  keyLevels: [{
    price: Number,
    type: { type: String, enum: ['SUPPORT', 'RESISTANCE'] },
    strength: Number
  }],
  
  volatility: {
    atrPct: Number,
    regime: String
  },
  
  mlScore: { type: Number },
  
  generatedAt: { type: Date, default: Date.now, index: true },
  validUntil: { type: Date },
  
  metadata: { type: Schema.Types.Mixed }
}, {
  timestamps: true,
  collection: 'ta_decisions'
});

// Compound indexes
TaDecisionSchema.index({ asset: 1, generatedAt: -1 });
TaDecisionSchema.index({ action: 1, confidence: -1 });

export const TaDecisionModel = mongoose.model<ITaDecision>('TaDecision', TaDecisionSchema);
