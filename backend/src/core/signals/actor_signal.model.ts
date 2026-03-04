/**
 * Actor Signals Model (v2)
 * Signals = deviations from baseline
 * 
 * NOT predictions, NOT recommendations
 * Just: "what changed relative to norm"
 */
import mongoose from 'mongoose';

// Signal types for Sprint 3
export type ActorSignalType = 
  | 'flow_deviation'           // Actor flow changed vs baseline
  | 'corridor_volume_spike'    // Corridor between actors spiked
  | 'cluster_participation'    // Actor in more/fewer clusters
  | 'behavior_regime_shift';   // Pattern changed (balanced → outflow)

export type SignalSeverity = 'low' | 'medium' | 'high';

const ActorSignalSchema = new mongoose.Schema({
  // Core identification
  actorId: { type: String, required: true, index: true },
  actorSlug: { type: String, required: true, index: true },
  actorType: { 
    type: String, 
    enum: ['exchange', 'fund', 'whale', 'market_maker', 'trader', 'unknown'],
    required: true,
    index: true 
  },
  
  // Signal classification
  signalType: { 
    type: String, 
    enum: ['flow_deviation', 'corridor_volume_spike', 'cluster_participation', 'behavior_regime_shift'],
    required: true,
    index: true
  },
  
  // What deviated
  metric: { type: String, required: true }, // e.g., "outflow", "corridor_volume", "cluster_count"
  
  // Deviation magnitude (multiplier vs baseline)
  deviation: { type: Number, required: true }, // e.g., 4.8 means 4.8× baseline
  
  // Time window
  window: { 
    type: String, 
    enum: ['1h', '6h', '24h'],
    required: true,
    index: true 
  },
  
  // Detection timestamp
  detectedAt: { type: Date, default: Date.now, index: true },
  
  // Evidence (contextual data)
  evidence: {
    tokens: [{ type: String }],           // Token addresses involved
    corridors: [{                          // Corridors involved
      from: String,
      to: String,
      volumeUsd: Number,
    }],
    clusters: [{                           // Clusters involved
      clusterId: String,
      walletCount: Number,
    }],
    previousValue: { type: Number },       // What it was
    currentValue: { type: Number },        // What it is now
    baselineValue: { type: Number },       // Expected baseline
  },
  
  // Human-readable interpretation (descriptive, NOT predictive)
  interpretation: { type: String, required: true },
  
  // Severity = degree of deviation, NOT importance or bullishness
  severity: { 
    type: String, 
    enum: ['low', 'medium', 'high'],
    required: true,
    index: true
  },
  
  // Expiration (signals are time-sensitive)
  expiresAt: { type: Date, index: true },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'expired'],
    default: 'active',
    index: true
  },
  
}, {
  collection: 'actor_signals',
  timestamps: true,
});

// Indexes for querying
ActorSignalSchema.index({ actorSlug: 1, detectedAt: -1 });
ActorSignalSchema.index({ signalType: 1, severity: 1, detectedAt: -1 });
ActorSignalSchema.index({ actorType: 1, signalType: 1, detectedAt: -1 });
ActorSignalSchema.index({ status: 1, expiresAt: 1 });

// TTL index for auto-cleanup (expire after 7 days)
ActorSignalSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ActorSignalModel = mongoose.model('ActorSignal', ActorSignalSchema);
