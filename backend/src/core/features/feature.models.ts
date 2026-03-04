/**
 * P2.1 Feature Store - Models & Types
 * 
 * Core feature collections for ML/Twitter/Ranking
 * Network-first, time-windowed, deterministic
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// WINDOW TYPES
// ============================================

export interface WindowValues {
  w15m?: number;
  w1h?: number;
  w6h?: number;
  w24h?: number;
  w7d?: number;
}

export const WindowValuesSchema = new Schema<WindowValues>({
  w15m: Number,
  w1h: Number,
  w6h: Number,
  w24h: Number,
  w7d: Number,
}, { _id: false });

// ============================================
// FEATURE ACTOR TIMESERIES
// ============================================

export interface IFeatureActor {
  network: string;
  actorId: string;
  bucketTs: number;
  bucketSec: number;
  
  flows: {
    inUsd: WindowValues;
    outUsd: WindowValues;
    netUsd: WindowValues;
  };
  
  activity: {
    txCount: WindowValues;
    uniqueCounterparties: WindowValues;
    activeHours: WindowValues;
  };
  
  exposure: {
    cexInUsd: WindowValues;
    cexOutUsd: WindowValues;
    bridgeOutUsd: WindowValues;
    mixerOutUsd: WindowValues;
    dexNetUsd: WindowValues;
  };
  
  structure: {
    fanIn: WindowValues;
    fanOut: WindowValues;
    entropyOut: WindowValues;
    topOutShare: WindowValues;
  };
  
  scores: {
    influenceScore: number;
    trustScore: number;
    whaleScore: number;
    noiseScore: number;
  };
  
  meta: {
    computedAtTs: number;
    dataWindowMaxTs: number;
    version: string;
  };
}

const FeatureActorSchema = new Schema<IFeatureActor>({
  network: { type: String, required: true, index: true },
  actorId: { type: String, required: true, index: true },
  bucketTs: { type: Number, required: true, index: true },
  bucketSec: { type: Number, default: 900 },
  
  flows: {
    inUsd: WindowValuesSchema,
    outUsd: WindowValuesSchema,
    netUsd: WindowValuesSchema,
  },
  
  activity: {
    txCount: WindowValuesSchema,
    uniqueCounterparties: WindowValuesSchema,
    activeHours: WindowValuesSchema,
  },
  
  exposure: {
    cexInUsd: WindowValuesSchema,
    cexOutUsd: WindowValuesSchema,
    bridgeOutUsd: WindowValuesSchema,
    mixerOutUsd: WindowValuesSchema,
    dexNetUsd: WindowValuesSchema,
  },
  
  structure: {
    fanIn: WindowValuesSchema,
    fanOut: WindowValuesSchema,
    entropyOut: WindowValuesSchema,
    topOutShare: WindowValuesSchema,
  },
  
  scores: {
    influenceScore: { type: Number, default: 0 },
    trustScore: { type: Number, default: 0 },
    whaleScore: { type: Number, default: 0 },
    noiseScore: { type: Number, default: 0 },
  },
  
  meta: {
    computedAtTs: { type: Number, required: true },
    dataWindowMaxTs: { type: Number },
    version: { type: String, default: 'P2.1.0' },
  },
}, {
  timestamps: false,
  collection: 'feature_actor_timeseries',
});

// Compound index for efficient queries
FeatureActorSchema.index({ network: 1, actorId: 1, bucketTs: -1 }, { unique: true });

export const FeatureActorModel = mongoose.models.FeatureActor || 
  mongoose.model<IFeatureActor>('FeatureActor', FeatureActorSchema);

// ============================================
// FEATURE CORRIDOR TIMESERIES
// ============================================

export interface IFeatureCorridor {
  network: string;
  corridorKey: string;  // e.g. "OUT:WALLET->CEX"
  bucketTs: number;
  bucketSec: number;
  
  flow: {
    volumeUsd: WindowValues;
    txCount: WindowValues;
    uniqueActors: WindowValues;
  };
  
  density: {
    persistence: WindowValues;
    volatility: WindowValues;
    entropyActors: WindowValues;
  };
  
  pressure: {
    directionBias: WindowValues;
  };
  
  // === V3.0 PACK A FEATURES (C - Corridor Intelligence) ===
  corridorV3?: {
    // Persistence metrics
    persistence_7d: number;
    persistence_30d: number;
    repeatRate: number;
    
    // Flow trend
    netFlowTrend: number;  // slope of netFlow over time
    
    // Entropy & Concentration
    entropy: number;
    concentrationIndex: number;
    
    // Actor patterns
    topActorShare: number;
    newActorRate: number;
    
    // Quality
    qualityScore: number;
  };
  
  meta: {
    computedAtTs: number;
    version: string;
  };
}

const FeatureCorridorSchema = new Schema<IFeatureCorridor>({
  network: { type: String, required: true, index: true },
  corridorKey: { type: String, required: true, index: true },
  bucketTs: { type: Number, required: true, index: true },
  bucketSec: { type: Number, default: 3600 },
  
  flow: {
    volumeUsd: WindowValuesSchema,
    txCount: WindowValuesSchema,
    uniqueActors: WindowValuesSchema,
  },
  
  density: {
    persistence: WindowValuesSchema,
    volatility: WindowValuesSchema,
    entropyActors: WindowValuesSchema,
  },
  
  pressure: {
    directionBias: WindowValuesSchema,
  },
  
  // === V3.0 PACK A FEATURES ===
  corridorV3: {
    persistence_7d: { type: Number },
    persistence_30d: { type: Number },
    repeatRate: { type: Number },
    netFlowTrend: { type: Number },
    entropy: { type: Number },
    concentrationIndex: { type: Number },
    topActorShare: { type: Number },
    newActorRate: { type: Number },
    qualityScore: { type: Number },
  },
  
  meta: {
    computedAtTs: { type: Number, required: true },
    version: { type: String, default: 'P2.1.0' },
  },
}, {
  timestamps: false,
  collection: 'feature_corridor_timeseries',
});

FeatureCorridorSchema.index({ network: 1, corridorKey: 1, bucketTs: -1 }, { unique: true });

export const FeatureCorridorModel = mongoose.models.FeatureCorridor || 
  mongoose.model<IFeatureCorridor>('FeatureCorridor', FeatureCorridorSchema);

// ============================================
// FEATURE MARKET TIMESERIES
// ============================================

export interface IFeatureMarket {
  network: string;
  bucketTs: number;
  bucketSec: number;
  
  cexPressure: {
    cexInUsd: WindowValues;
    cexOutUsd: WindowValues;
    pressure: WindowValues;
  };
  
  zones: {
    accumulationStrength: WindowValues;
    distributionStrength: WindowValues;
    marketRegime: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
  };
  
  corridors: {
    entropy: WindowValues;
    topCorridors: Array<{ key: string; volumeUsd: number }>;
  };
  
  // === V3.0 PACK A FEATURES ===
  
  // A) CEX Pressure v3 - History + Spikes
  cexPressureV3?: {
    pressure_5m: number;
    pressure_1h: number;
    pressure_1d: number;
    inDelta_1h: number;
    outDelta_1h: number;
    spikeLevel: 'NONE' | 'MEDIUM' | 'HIGH';
    spikeDirection?: 'BUY' | 'SELL' | null;
  };
  
  // B) Zones v3 - Persistence + Decay + Quality
  zonesV3?: {
    persistence_7d: number;
    persistence_30d: number;
    decayScore: number;
    qualityScore: number;
    confirmedStreak: number;
    lastConfirmedAt?: number;
  };
  
  meta: {
    computedAtTs: number;
    version: string;
  };
}

const FeatureMarketSchema = new Schema<IFeatureMarket>({
  network: { type: String, required: true, index: true },
  bucketTs: { type: Number, required: true, index: true },
  bucketSec: { type: Number, default: 900 },
  
  cexPressure: {
    cexInUsd: WindowValuesSchema,
    cexOutUsd: WindowValuesSchema,
    pressure: WindowValuesSchema,
  },
  
  zones: {
    accumulationStrength: WindowValuesSchema,
    distributionStrength: WindowValuesSchema,
    marketRegime: { 
      type: String, 
      enum: ['ACCUMULATION', 'DISTRIBUTION', 'NEUTRAL'],
      default: 'NEUTRAL'
    },
  },
  
  corridors: {
    entropy: WindowValuesSchema,
    topCorridors: [{
      key: String,
      volumeUsd: Number,
    }],
  },
  
  // === V3.0 PACK A FEATURES ===
  cexPressureV3: {
    pressure_5m: { type: Number },
    pressure_1h: { type: Number },
    pressure_1d: { type: Number },
    inDelta_1h: { type: Number },
    outDelta_1h: { type: Number },
    spikeLevel: { type: String, enum: ['NONE', 'MEDIUM', 'HIGH'], default: 'NONE' },
    spikeDirection: { type: String, enum: ['BUY', 'SELL', null], default: null },
  },
  
  zonesV3: {
    persistence_7d: { type: Number },
    persistence_30d: { type: Number },
    decayScore: { type: Number },
    qualityScore: { type: Number },
    confirmedStreak: { type: Number },
    lastConfirmedAt: { type: Number },
  },
  
  meta: {
    computedAtTs: { type: Number, required: true },
    version: { type: String, default: 'P2.1.0' },
  },
}, {
  timestamps: false,
  collection: 'feature_market_timeseries',
});

FeatureMarketSchema.index({ network: 1, bucketTs: -1 }, { unique: true });

export const FeatureMarketModel = mongoose.models.FeatureMarket || 
  mongoose.model<IFeatureMarket>('FeatureMarket', FeatureMarketSchema);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Floor timestamp to bucket
 */
export function toBucket(ts: number, bucketSec: number): number {
  return Math.floor(ts / bucketSec) * bucketSec;
}

/**
 * Get window boundaries
 */
export function getWindowBoundaries(bucketTs: number): Record<string, { start: number; end: number }> {
  return {
    w15m: { start: bucketTs - 900, end: bucketTs },
    w1h: { start: bucketTs - 3600, end: bucketTs },
    w6h: { start: bucketTs - 21600, end: bucketTs },
    w24h: { start: bucketTs - 86400, end: bucketTs },
    w7d: { start: bucketTs - 604800, end: bucketTs },
  };
}

/**
 * Calculate entropy (normalized)
 */
export function calculateEntropy(values: number[]): number {
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0 || values.length < 2) return 0;
  
  const probs = values.map(v => v / total).filter(p => p > 0);
  const H = -probs.reduce((sum, p) => sum + p * Math.log(p), 0);
  const maxH = Math.log(values.length);
  
  return maxH > 0 ? H / maxH : 0;
}

/**
 * Clamp value to 0-1
 */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export default {
  FeatureActorModel,
  FeatureCorridorModel,
  FeatureMarketModel,
  toBucket,
  getWindowBoundaries,
  calculateEntropy,
  clamp01,
};
