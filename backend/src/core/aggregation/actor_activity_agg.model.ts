/**
 * ETAP 6.2.2 — Actor Activity Aggregation Model
 * 
 * Tracks activity patterns per actor per window.
 * Key: { actorId, window }
 */
import mongoose from 'mongoose';

export type ParticipationTrend = 'increasing' | 'stable' | 'decreasing';

export interface IActorActivityAgg {
  actorId: string;
  window: '24h' | '7d' | '30d';
  
  active_days: number;
  avg_tx_per_day: number;
  peak_tx_day: number;
  
  participation_trend: ParticipationTrend;
  burst_score: number;          // 0-100 volatility score
  
  updatedAt: Date;
}

const ActorActivityAggSchema = new mongoose.Schema<IActorActivityAgg>({
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
  
  active_days: {
    type: Number,
    default: 0,
  },
  avg_tx_per_day: {
    type: Number,
    default: 0,
  },
  peak_tx_day: {
    type: Number,
    default: 0,
  },
  
  participation_trend: {
    type: String,
    enum: ['increasing', 'stable', 'decreasing'],
    default: 'stable',
  },
  burst_score: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  collection: 'actor_activity_agg',
  timestamps: false,
});

// Unique key per actor + window
ActorActivityAggSchema.index({ actorId: 1, window: 1 }, { unique: true });

// Query indexes
ActorActivityAggSchema.index({ window: 1, burst_score: -1 });
ActorActivityAggSchema.index({ window: 1, participation_trend: 1 });

export const ActorActivityAggModel = mongoose.model<IActorActivityAgg>(
  'ActorActivityAgg',
  ActorActivityAggSchema
);
