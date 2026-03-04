/**
 * PHASE 1.4 — Truth Record Model
 * ================================
 * 
 * MongoDB model for storing truth evaluations.
 * 
 * IMMUTABLE after creation - truth is never rewritten!
 */

import mongoose from 'mongoose';

const TruthRecordSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  tf: { type: String, required: true, index: true },
  
  // Verdict info (t0)
  verdictTs: { type: Number, required: true, index: true },
  verdict: { type: String, required: true, enum: ['BULLISH', 'BEARISH', 'NEUTRAL', 'INCONCLUSIVE', 'NO_DATA'] },
  confidence: { type: Number, required: true },
  
  // Evaluation info (t1)
  evaluationTs: { type: Number, required: true },
  horizonBars: { type: Number, required: true },
  threshold: { type: Number, required: true },
  
  // Outcome
  priceAtT0: { type: Number, required: true },
  priceAtT1: { type: Number, required: true },
  priceChangePct: { type: Number, required: true },
  priceDirection: { type: String, required: true, enum: ['UP', 'DOWN', 'FLAT'] },
  outcome: { type: String, required: true, enum: ['CONFIRMED', 'DIVERGED', 'NO_DATA'], index: true },
  
  // Metadata
  reason: { type: String },
  createdAt: { type: Number, required: true },
}, {
  timestamps: false,
  collection: 'market_truth_records',
});

// Compound unique index - one truth per verdict timestamp
TruthRecordSchema.index({ symbol: 1, tf: 1, verdictTs: 1 }, { unique: true });

export const TruthRecordModel = mongoose.model('TruthRecord', TruthRecordSchema);

console.log('[Phase 1.4] TruthRecord Model loaded');
