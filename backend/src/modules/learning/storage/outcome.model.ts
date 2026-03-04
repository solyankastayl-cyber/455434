/**
 * PHASE 5.1 — Outcome Storage
 * ============================
 * MongoDB model for decision outcomes
 */

import mongoose, { Schema, Document } from 'mongoose';
import { DecisionOutcome, HorizonOutcome } from '../contracts/outcome.types.js';

export interface IDecisionOutcome extends Document, Omit<DecisionOutcome, '_id'> {}

const HorizonOutcomeSchema = new Schema<HorizonOutcome>(
  {
    horizon: { type: String, required: true, enum: ['1h', '4h', '24h'] },
    priceAtHorizon: { type: Number, default: null },
    changePct: { type: Number, default: null },
    directionCorrect: { type: Boolean, default: null },
    calculatedAt: { type: Number, default: null },
  },
  { _id: false }
);

const DecisionOutcomeSchema = new Schema<IDecisionOutcome>(
  {
    decisionId: { type: String, required: true, unique: true, index: true },
    symbol: { type: String, required: true, index: true },
    decisionTimestamp: { type: Number, required: true, index: true },
    
    action: { type: String, required: true, enum: ['BUY', 'SELL', 'AVOID'], index: true },
    confidence: { type: Number, required: true },
    verdict: { type: String, required: true, enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    
    priceAtDecision: { type: Number, required: true },
    
    horizons: { type: [HorizonOutcomeSchema], default: [] },
    
    directionCorrect: { type: Boolean, default: null, index: true },
    bestPnlPct: { type: Number, default: null },
    worstPnlPct: { type: Number, default: null },
    
    status: { 
      type: String, 
      required: true, 
      enum: ['PENDING', 'CALCULATED', 'SKIPPED', 'ERROR'],
      default: 'PENDING',
      index: true 
    },
    errorMessage: { type: String },
    
    completedAt: { type: Date },
  },
  {
    collection: 'decision_outcomes',
    timestamps: true,
  }
);

// Compound indexes for analytics
DecisionOutcomeSchema.index({ symbol: 1, status: 1, decisionTimestamp: -1 });
DecisionOutcomeSchema.index({ action: 1, directionCorrect: 1, decisionTimestamp: -1 });
DecisionOutcomeSchema.index({ status: 1, decisionTimestamp: 1 }); // For pending processing

export const DecisionOutcomeModel = mongoose.models.DecisionOutcome ||
  mongoose.model<IDecisionOutcome>('DecisionOutcome', DecisionOutcomeSchema);

console.log('[Phase 5.1] Outcome Storage Model loaded');
