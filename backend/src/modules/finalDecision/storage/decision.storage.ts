/**
 * PHASE 4 — Decision Storage
 * ===========================
 * MongoDB model for decision records
 */

import mongoose, { Schema, Document } from 'mongoose';
import { DecisionRecord } from '../contracts/decision.types.js';

export interface IDecisionRecord extends Document, Omit<DecisionRecord, '_id'> {}

const DecisionRecordSchema = new Schema<IDecisionRecord>(
  {
    symbol: { type: String, required: true, index: true },
    timestamp: { type: Number, required: true, index: true },
    
    action: { type: String, required: true, enum: ['BUY', 'SELL', 'AVOID'], index: true },
    confidence: { type: Number, required: true },
    reason: { type: String, required: true },
    
    explainability: {
      verdict: { type: String, required: true },
      rawConfidence: { type: Number, required: true },
      mlAdjustedConfidence: { type: Number, required: true },
      dataMode: { type: String, required: true },
      mlReady: { type: Boolean, required: true },
      appliedRules: { type: [String], default: [] },
      blockedBy: { type: String },
      riskFlags: {
        whaleRisk: { type: String },
        marketStress: { type: String },
        contradiction: { type: Boolean },
        liquidationRisk: { type: Boolean },
      },
    },
    
    policyVersion: { type: String, required: true },
    
    outcome: {
      priceAtDecision: { type: Number },
      priceAfter1h: { type: Number },
      priceAfter4h: { type: Number },
      priceAfter24h: { type: Number },
      wasCorrect: { type: Boolean },
      actualChangePct: { type: Number },
    },
  },
  {
    collection: 'final_decisions',
    timestamps: true,
  }
);

// Indexes for analytics
DecisionRecordSchema.index({ symbol: 1, timestamp: -1 });
DecisionRecordSchema.index({ action: 1, timestamp: -1 });
DecisionRecordSchema.index({ 'outcome.wasCorrect': 1, timestamp: -1 });

export const DecisionRecordModel = mongoose.models.DecisionRecord ||
  mongoose.model<IDecisionRecord>('DecisionRecord', DecisionRecordSchema);

console.log('[Phase 4] Decision Storage loaded');
