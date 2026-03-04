/**
 * ETAP 6.2.1 — Actor Flow Aggregation Model
 * 
 * Tracks inflow/outflow/net flow per actor per window.
 * Key: { actorId, window }
 * 
 * P1.2 Enhanced: direction_ratio, imbalance_score
 */
import mongoose from 'mongoose';

export interface IActorFlowAgg {
  actorId: string;
  window: '24h' | '7d' | '30d';
  
  inflow_usd: number;
  outflow_usd: number;
  net_flow_usd: number;
  
  inflow_tx_count: number;          // P1.2: separate tx counts
  outflow_tx_count: number;         // P1.2: separate tx counts
  tx_count: number;
  unique_tokens: number;
  unique_counterparties: number;
  
  // P1.2 Enhanced fields
  inflow_actors: string[];          // Who flows in
  outflow_actors: string[];         // Who flows out
  direction_ratio: number;          // inflow / (outflow + ε)
  imbalance_score: number;          // normalized 0-100
  
  first_seen: Date;
  last_seen: Date;
  
  updatedAt: Date;
}

const ActorFlowAggSchema = new mongoose.Schema<IActorFlowAgg>({
  actorId: {
    type: String,
    required: true,
    index: true,
  },
  window: {
    type: String,
    required: true,
    enum: ['24h', '7d', '30d'],
  },
  
  inflow_usd: {
    type: Number,
    default: 0,
  },
  outflow_usd: {
    type: Number,
    default: 0,
  },
  net_flow_usd: {
    type: Number,
    default: 0,
  },
  
  inflow_tx_count: {
    type: Number,
    default: 0,
  },
  outflow_tx_count: {
    type: Number,
    default: 0,
  },
  tx_count: {
    type: Number,
    default: 0,
  },
  unique_tokens: {
    type: Number,
    default: 0,
  },
  unique_counterparties: {
    type: Number,
    default: 0,
  },
  
  // P1.2 Enhanced
  inflow_actors: [{
    type: String,
  }],
  outflow_actors: [{
    type: String,
  }],
  direction_ratio: {
    type: Number,
    default: 1,
  },
  imbalance_score: {
    type: Number,
    default: 50,
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
  collection: 'actor_flow_agg',
  timestamps: false,
});

// Unique key per actor + window
ActorFlowAggSchema.index({ actorId: 1, window: 1 }, { unique: true });

// Query indexes
ActorFlowAggSchema.index({ window: 1, net_flow_usd: -1 });
ActorFlowAggSchema.index({ window: 1, tx_count: -1 });
ActorFlowAggSchema.index({ window: 1, imbalance_score: -1 }); // P1.2

export const ActorFlowAggModel = mongoose.model<IActorFlowAgg>(
  'ActorFlowAgg',
  ActorFlowAggSchema
);
