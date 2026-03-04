/**
 * ETAP 6.2.3 — Bridge Aggregation Model
 * 
 * Tracks cross-entity relationships per window.
 * Key: { entityA, entityB, window }
 * 
 * Used for:
 * - Graph edges
 * - NEW_CORRIDOR signals
 * - NEW_BRIDGE signals
 */
import mongoose from 'mongoose';

export interface IBridgeAgg {
  entityA: string;
  entityB: string;
  window: '24h' | '7d' | '30d';
  
  flow_overlap: number;         // shared USD volume
  temporal_sync: number;        // correlation 0..1
  token_overlap: number;        // Jaccard index 0..1
  direction_balance: number;    // inflow vs outflow ratio (-1 to 1)
  
  evidence_count: number;       // number of transactions
  
  updatedAt: Date;
}

const BridgeAggSchema = new mongoose.Schema<IBridgeAgg>({
  entityA: {
    type: String,
    required: true,
    index: true,
  },
  entityB: {
    type: String,
    required: true,
    index: true,
  },
  window: {
    type: String,
    required: true,
    enum: ['24h', '7d', '30d'],
  },
  
  flow_overlap: {
    type: Number,
    default: 0,
  },
  temporal_sync: {
    type: Number,
    default: 0,
    min: 0,
    max: 1,
  },
  token_overlap: {
    type: Number,
    default: 0,
    min: 0,
    max: 1,
  },
  direction_balance: {
    type: Number,
    default: 0,
    min: -1,
    max: 1,
  },
  
  evidence_count: {
    type: Number,
    default: 0,
  },
  
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  collection: 'bridge_agg',
  timestamps: false,
});

// Unique key per entity pair + window (normalized order)
BridgeAggSchema.index({ entityA: 1, entityB: 1, window: 1 }, { unique: true });

// Query indexes
BridgeAggSchema.index({ window: 1, flow_overlap: -1 });
BridgeAggSchema.index({ window: 1, evidence_count: -1 });

export const BridgeAggModel = mongoose.model<IBridgeAgg>(
  'BridgeAgg',
  BridgeAggSchema
);
