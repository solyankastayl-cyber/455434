/**
 * PHASE 2.3 — Confidence Decay Model
 * ====================================
 * 
 * MongoDB model for storing confidence decay records.
 * 
 * Collection: confidence_decay_v1
 */

import mongoose from 'mongoose';

const ConfidenceRecordSchema = new mongoose.Schema({
  recordId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  symbol: { 
    type: String, 
    required: true, 
    index: true 
  },
  verdict: { 
    type: String, 
    enum: ['BULLISH', 'BEARISH', 'NEUTRAL', 'ALL'],
    required: true 
  },

  // Historical stats
  windowBars: { type: Number, required: true },
  total: { type: Number, required: true },
  confirmed: { type: Number, required: true },
  diverged: { type: Number, required: true },

  // Decay calculation
  confirmationRate: { type: Number, required: true },
  decayFactor: { type: Number, required: true },

  // Applied confidence
  rawConfidence: { type: Number, required: true },
  adjustedConfidence: { type: Number, required: true },

  // Metadata
  calculatedAt: { type: Number, required: true, index: true },
  version: { type: String, default: 'v1' },
}, {
  timestamps: true,
  collection: 'confidence_decay_v1',
});

// Compound index for efficient queries
ConfidenceRecordSchema.index({ symbol: 1, verdict: 1, calculatedAt: -1 });

export const ConfidenceRecordModel = mongoose.model('ConfidenceRecord', ConfidenceRecordSchema);

console.log('[Phase 2.3] Confidence Decay Model loaded');
