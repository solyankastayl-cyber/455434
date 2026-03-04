/**
 * P1.2 — Edge Flow Aggregation Model
 * 
 * Tracks flows between actor pairs.
 * Key: { fromActorId, toActorId, window }
 * 
 * Used for:
 * - Graph strands
 * - NEW_CORRIDOR detection
 * - DENSITY_SPIKE detection
 */
import mongoose from 'mongoose';

export type EdgeDirection = 'IN' | 'OUT' | 'BI';

export interface IEdgeFlowAgg {
  fromActorId: string;
  toActorId: string;
  window: '24h' | '7d' | '30d';
  
  flow_usd: number;
  tx_count: number;
  
  direction: EdgeDirection;
  confidence: number;           // Based on tx_count + volume (0-100)
  
  // Tokens involved
  tokens: string[];
  dominant_token?: string;
  
  // Temporal
  first_seen: Date;
  last_seen: Date;
  
  updatedAt: Date;
}

const EdgeFlowAggSchema = new mongoose.Schema<IEdgeFlowAgg>({
  fromActorId: {
    type: String,
    required: true,
    index: true,
  },
  toActorId: {
    type: String,
    required: true,
    index: true,
  },
  window: {
    type: String,
    required: true,
    enum: ['24h', '7d', '30d'],
  },
  
  flow_usd: {
    type: Number,
    default: 0,
  },
  tx_count: {
    type: Number,
    default: 0,
  },
  
  direction: {
    type: String,
    enum: ['IN', 'OUT', 'BI'],
    default: 'OUT',
  },
  confidence: {
    type: Number,
    default: 0,
  },
  
  tokens: [{
    type: String,
  }],
  dominant_token: {
    type: String,
  },
  
  first_seen: {
    type: Date,
  },
  last_seen: {
    type: Date,
  },
  
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  collection: 'edge_flow_agg',
  timestamps: false,
});

// Unique key per edge + window
EdgeFlowAggSchema.index({ fromActorId: 1, toActorId: 1, window: 1 }, { unique: true });

// Query indexes
EdgeFlowAggSchema.index({ window: 1, flow_usd: -1 });
EdgeFlowAggSchema.index({ window: 1, tx_count: -1 });
EdgeFlowAggSchema.index({ fromActorId: 1, window: 1 });
EdgeFlowAggSchema.index({ toActorId: 1, window: 1 });

export const EdgeFlowAggModel = mongoose.model<IEdgeFlowAgg>(
  'EdgeFlowAgg',
  EdgeFlowAggSchema
);

/**
 * Calculate edge confidence from tx_count and volume
 */
export function calculateEdgeConfidence(txCount: number, flowUsd: number): number {
  // tx_count contributes up to 50, volume contributes up to 50
  const txScore = Math.min(50, txCount * 5);
  const volumeScore = Math.min(50, Math.log10(flowUsd + 1) * 10);
  return Math.round(txScore + volumeScore);
}
