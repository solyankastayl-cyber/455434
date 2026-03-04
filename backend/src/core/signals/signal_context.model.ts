/**
 * Signal Context Model (P3.1)
 * 
 * Aggregates related signals into contextual situations
 * 
 * Philosophy:
 * - One signal means nothing
 * - Multiple synchronous signals = event
 * - overlapScore = coverage/density, NOT confidence
 * - NO intent, NO prediction, just "what's happening together"
 */
import mongoose from 'mongoose';

const SignalContextSchema = new mongoose.Schema({
  // Time window for context
  window: { 
    type: String, 
    enum: ['1h', '6h', '24h'],
    required: true,
    index: true 
  },
  
  // Primary signal that triggered this context
  primarySignal: {
    type: { 
      type: String, 
      enum: [
        'token_flow_deviation',
        'actor_flow_deviation', 
        'corridor_volume_spike',
        'behavior_regime_shift',
        'cluster_participation',
        'market_narrative'
      ],
      required: true 
    },
    sourceType: { 
      type: String, 
      enum: ['token', 'actor', 'corridor', 'market'],
      required: true 
    },
    sourceId: { type: String, required: true },
    deviation: { type: Number },
    severity: { type: String, enum: ['low', 'medium', 'high'] },
  },
  
  // Related signals grouped together
  relatedSignals: {
    tokens: [{ 
      tokenId: String,
      symbol: String,
      signalType: String,
      deviation: Number,
    }],
    actors: [{
      actorId: String,
      slug: String,
      signalType: String,
      deviation: Number,
    }],
    corridors: [{
      from: String,
      to: String,
      signalType: String,
      volumeUsd: Number,
    }],
  },
  
  // Overlap score = how many signals coincide (NOT confidence)
  overlapScore: { type: Number, required: true, min: 2 },
  
  // Affected assets (resolved symbols)
  affectedAssets: [{ type: String }], // ETH, USDT, AI tokens
  
  // Involved actors (slugs)
  involvedActors: [{ type: String }],
  
  // Descriptive summary (NOT predictive)
  summary: { type: String, required: true },
  
  // Optional narrative hint
  narrativeHint: { type: String },
  
  // Context validity
  detectedAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, index: true },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'expired'],
    default: 'active',
    index: true
  },
  
}, {
  collection: 'signal_contexts',
  timestamps: true,
});

// Indexes
SignalContextSchema.index({ window: 1, overlapScore: -1 });
SignalContextSchema.index({ 'primarySignal.type': 1, detectedAt: -1 });
SignalContextSchema.index({ affectedAssets: 1 });
SignalContextSchema.index({ involvedActors: 1 });
SignalContextSchema.index({ status: 1, expiresAt: 1 });

// TTL index
SignalContextSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SignalContextModel = mongoose.model('SignalContext', SignalContextSchema);
