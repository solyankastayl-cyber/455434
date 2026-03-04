/**
 * ML Signal Outcomes Model - ML v2.1 STEP 1
 * 
 * Stores validation results for ML predictions.
 * This is the foundation of the self-learning loop.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// TYPES
// ============================================

export type PredictedSide = 'BUY' | 'SELL' | 'NEUTRAL';
export type OutcomeResult = 'CORRECT' | 'WRONG' | 'NEUTRAL' | 'SKIPPED';
export type OutcomeReason = 'NO_PRICE' | 'LOW_MOVE' | 'TIMEOUT' | 'OK';
export type Horizon = '1h' | '4h' | '24h';

export interface ISignalOutcome extends Document {
  signalId: string;
  network: string;
  asset: string;
  
  // Prediction
  predictedSide: PredictedSide;
  predictedScore: number;
  confidence: number;
  modelVersion: string;
  
  // Prices
  entryPrice: number | null;
  exitPrice: number | null;
  actualReturnPct: number | null;
  
  // Outcome
  outcome: OutcomeResult;
  reason: OutcomeReason;
  horizon: Horizon;
  
  // Timestamps
  signalTimestamp: Date;
  evaluatedAt: Date;
  createdAt: Date;
}

// ============================================
// SCHEMA
// ============================================

const SignalOutcomeSchema = new Schema<ISignalOutcome>(
  {
    signalId: { type: String, required: true, index: true },
    network: { type: String, required: true, index: true },
    asset: { type: String, required: true, index: true },
    
    // Prediction
    predictedSide: { 
      type: String, 
      enum: ['BUY', 'SELL', 'NEUTRAL'], 
      required: true 
    },
    predictedScore: { type: Number, default: 0 },
    confidence: { type: Number, default: 0 },
    modelVersion: { type: String, default: 'v2.0.0' },
    
    // Prices
    entryPrice: { type: Number, default: null },
    exitPrice: { type: Number, default: null },
    actualReturnPct: { type: Number, default: null },
    
    // Outcome
    outcome: { 
      type: String, 
      enum: ['CORRECT', 'WRONG', 'NEUTRAL', 'SKIPPED'], 
      required: true,
      index: true 
    },
    reason: { 
      type: String, 
      enum: ['NO_PRICE', 'LOW_MOVE', 'TIMEOUT', 'OK'], 
      default: 'OK' 
    },
    horizon: { 
      type: String, 
      enum: ['1h', '4h', '24h'], 
      default: '4h',
      index: true 
    },
    
    // Timestamps
    signalTimestamp: { type: Date, required: true },
    evaluatedAt: { type: Date, default: Date.now },
  },
  { 
    timestamps: true,
    collection: 'ml_signal_outcomes' 
  }
);

// Compound indexes for queries
SignalOutcomeSchema.index({ network: 1, outcome: 1, createdAt: -1 });
SignalOutcomeSchema.index({ modelVersion: 1, outcome: 1 });
SignalOutcomeSchema.index({ signalId: 1 }, { unique: true });

export const SignalOutcomeModel = mongoose.model<ISignalOutcome>(
  'SignalOutcome',
  SignalOutcomeSchema
);

export default SignalOutcomeModel;
