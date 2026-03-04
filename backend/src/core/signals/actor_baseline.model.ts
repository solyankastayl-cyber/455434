/**
 * Actor Baselines Model
 * Stores calculated baseline metrics for each actor
 * Used to detect deviations (signals)
 * 
 * Philosophy: Baseline = median over window, not average
 */
import mongoose from 'mongoose';

const ActorBaselineSchema = new mongoose.Schema({
  // Actor reference
  actorId: { type: String, required: true, index: true },
  actorSlug: { type: String, required: true, index: true },
  actorType: { 
    type: String, 
    enum: ['exchange', 'fund', 'whale', 'market_maker', 'trader', 'unknown'],
    required: true,
    index: true 
  },
  
  // Baseline window
  window: { 
    type: String, 
    enum: ['7d', '30d'],
    required: true,
    index: true 
  },
  
  // Flow baselines (median values)
  flows: {
    netFlowUsd: { type: Number, default: 0 },
    inflowUsd: { type: Number, default: 0 },
    outflowUsd: { type: Number, default: 0 },
    txCount: { type: Number, default: 0 },
  },
  
  // Corridor baselines
  corridors: {
    avgVolumeUsd: { type: Number, default: 0 },
    activeCorridorCount: { type: Number, default: 0 },
  },
  
  // Cluster participation
  clusters: {
    participationCount: { type: Number, default: 0 },
    overlapScore: { type: Number, default: 0 },
  },
  
  // Behavior pattern
  behavior: {
    dominantPattern: { 
      type: String, 
      enum: ['balanced', 'net_inflow', 'net_outflow', 'dormant', 'unknown'],
      default: 'unknown'
    },
    activityLevel: {
      type: String,
      enum: ['high', 'medium', 'low', 'dormant'],
      default: 'medium'
    },
  },
  
  // Calculation metadata
  calculatedAt: { type: Date, default: Date.now },
  dataPoints: { type: Number, default: 0 }, // How many data points used
  
}, {
  collection: 'actor_baselines',
  timestamps: true,
});

// Compound index for fast lookups
ActorBaselineSchema.index({ actorSlug: 1, window: 1 }, { unique: true });
ActorBaselineSchema.index({ actorType: 1, window: 1 });

export const ActorBaselineModel = mongoose.model('ActorBaseline', ActorBaselineSchema);
