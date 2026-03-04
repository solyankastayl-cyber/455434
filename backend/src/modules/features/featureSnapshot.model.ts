/**
 * PHASE 2.1 — Feature Snapshot Model
 * ====================================
 * 
 * MongoDB model for storing feature snapshots.
 * 
 * Collection: feature_snapshots
 * 
 * IMMUTABLE: Once created, snapshots are never modified.
 */

import mongoose from 'mongoose';

const FeatureSnapshotSchema = new mongoose.Schema({
  snapshotId: { 
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
  timestamp: { 
    type: Number, 
    required: true, 
    index: true 
  },

  // Exchange context
  exchange: {
    verdict: { 
      type: String, 
      enum: ['BULLISH', 'BEARISH', 'NEUTRAL', 'NO_DATA'],
      required: true 
    },
    confidence: { type: Number, required: true },
    regime: { type: String, default: 'UNKNOWN' },
    stress: { type: Number, default: 0 },
    patterns: [{ type: String }],
    whaleRisk: { 
      type: String, 
      enum: ['LOW', 'MID', 'HIGH', 'UNKNOWN'],
      default: 'UNKNOWN'
    },
    readiness: { 
      type: String, 
      enum: ['READY', 'RISKY', 'AVOID', 'DEGRADED', 'NO_DATA'],
      default: 'DEGRADED'
    },
  },

  // Sentiment context
  sentiment: {
    verdict: { 
      type: String, 
      enum: ['BULLISH', 'BEARISH', 'NEUTRAL', 'NO_DATA'],
      default: 'NO_DATA'
    },
    confidence: { type: Number, default: 0 },
    alignment: { 
      type: String, 
      enum: ['ALIGNED', 'PARTIAL', 'CONFLICT', 'NO_DATA'],
      default: 'NO_DATA'
    },
  },

  // Onchain context
  onchain: {
    validation: { 
      type: String, 
      enum: ['CONFIRMS', 'CONTRADICTS', 'NO_DATA'],
      default: 'NO_DATA'
    },
    confidence: { type: Number, default: 0 },
  },

  // Meta-Brain decision
  metaBrain: {
    finalVerdict: { type: String, required: true },
    finalConfidence: { type: Number, required: true },
    downgraded: { type: Boolean, default: false },
    downgradedBy: { type: String, default: null },
  },

  // Quality metadata
  meta: {
    dataCompleteness: { type: Number, required: true },
    providers: [{ type: String }],
    dataMode: { 
      type: String, 
      enum: ['LIVE', 'MOCK', 'MIXED'],
      required: true
    },
    version: { 
      type: String, 
      default: 'v1' 
    },
  },
}, {
  timestamps: true,
  collection: 'feature_snapshots',
});

// Compound index for efficient queries
FeatureSnapshotSchema.index({ symbol: 1, timestamp: -1 });

export const FeatureSnapshotModel = mongoose.model('FeatureSnapshot', FeatureSnapshotSchema);

console.log('[Phase 2.1] FeatureSnapshot Model loaded');
