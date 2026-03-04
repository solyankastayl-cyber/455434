/**
 * PHASE 2.2 — Dataset Model
 * ==========================
 * 
 * MongoDB model for ML dataset rows.
 * 
 * Collection: ml_dataset_v1
 * 
 * IMMUTABLE: Once created, dataset rows are never modified.
 */

import mongoose from 'mongoose';

const DatasetRowSchema = new mongoose.Schema({
  rowId: { 
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

  t0: { 
    type: Number, 
    required: true, 
    index: true 
  },
  t1: { 
    type: Number, 
    required: true 
  },

  snapshotId: { 
    type: String, 
    required: true, 
    index: true 
  },

  // Encoded features for ML
  features: {
    exchangeVerdict: { type: Number, required: true },
    exchangeConfidence: { type: Number, required: true },
    stress: { type: Number, required: true },
    whaleRisk: { type: Number, required: true },
    readinessScore: { type: Number, required: true },

    sentimentVerdict: { type: Number, required: true },
    sentimentConfidence: { type: Number, required: true },
    alignment: { type: Number, required: true },

    onchainValidation: { type: Number, required: true },
    onchainConfidence: { type: Number, required: true },

    dataCompleteness: { type: Number, required: true },
  },

  // Target (what happened)
  target: {
    priceChangePct: { type: Number, required: true },
    direction: { type: Number, enum: [1, -1, 0], required: true },
    confirmed: { type: Boolean, required: true },
    diverged: { type: Boolean, required: true },
    maxAdverseMove: { type: Number, default: 0 },
    maxFavorableMove: { type: Number, default: 0 },
  },

  // Metadata
  meta: {
    horizonBars: { type: Number, required: true },
    horizonHours: { type: Number, required: true },
    dataQuality: { type: Number, required: true },
    version: { type: String, default: 'v1' },
  },
}, {
  timestamps: true,
  collection: 'ml_dataset_v1',
});

// Compound indexes for efficient queries
DatasetRowSchema.index({ symbol: 1, t0: -1 });
DatasetRowSchema.index({ 'target.confirmed': 1, symbol: 1 });
DatasetRowSchema.index({ 'target.diverged': 1, symbol: 1 });

export const DatasetRowModel = mongoose.model('DatasetRow', DatasetRowSchema);

console.log('[Phase 2.2] Dataset Model loaded');
