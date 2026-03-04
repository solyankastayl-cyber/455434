/**
 * User Bias Model (Phase 12B.2)
 * 
 * Tracks implicit user behavior patterns.
 * What user ACTUALLY does (learned from actions).
 * 
 * bias ≠ preference
 * bias = what user really chooses, not what they say
 */
import mongoose, { Schema, Document, Types } from 'mongoose';
import { env } from '../../config/env.js';

export interface BiasVector {
  // Strategy biases (-0.5 to +0.5)
  strategy: Record<string, number>;
  
  // Behavioral biases
  risk: number;        // positive = risk-seeking, negative = risk-averse
  volatility: number;  // positive = likes volatile, negative = prefers stable
  influence: number;   // positive = follows whales, negative = prefers small actors
  momentum: number;    // positive = trend follower, negative = contrarian
}

export interface IUserBias extends Document {
  _id: Types.ObjectId;
  
  userId: string;
  
  // Learned bias vector
  biasVector: BiasVector;
  
  // Learning parameters
  learningRate: number;          // User-specific learning rate
  evidenceCount: number;         // Total decisions learned from
  confidenceLevel: number;       // How confident we are in the bias (0-1)
  
  // Saturation metric (0-1): how "trained" the user is
  biasSaturation: number;        // 0 = cold start, 1 = fully saturated
  coldStartCluster?: string;     // Initial cluster for cold start heuristic
  
  // Temporal tracking
  recentBiasShift: number;       // Change in last 7 days
  biasStability: number;         // 0-1, how stable is the bias
  
  // History
  biasHistory: {
    timestamp: Date;
    biasVector: BiasVector;
    trigger: string;
  }[];
  
  lastUpdated: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BiasVectorSchema = new Schema(
  {
    strategy: {
      type: Map,
      of: Number,
      default: {},
    },
    risk: { type: Number, default: 0 },
    volatility: { type: Number, default: 0 },
    influence: { type: Number, default: 0 },
    momentum: { type: Number, default: 0 },
  },
  { _id: false }
);

const BiasHistorySchema = new Schema(
  {
    timestamp: { type: Date, required: true },
    biasVector: { type: BiasVectorSchema, required: true },
    trigger: { type: String, required: true },
  },
  { _id: false }
);

const UserBiasSchema = new Schema<IUserBias>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    
    biasVector: {
      type: BiasVectorSchema,
      default: {
        strategy: {},
        risk: 0,
        volatility: 0,
        influence: 0,
        momentum: 0,
      },
    },
    
    learningRate: {
      type: Number,
      default: () => env.ADAPTIVE_LEARNING_RATE,
    },
    evidenceCount: {
      type: Number,
      default: 0,
    },
    confidenceLevel: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    
    // Saturation metric
    biasSaturation: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    coldStartCluster: {
      type: String,
    },
    
    recentBiasShift: {
      type: Number,
      default: 0,
    },
    biasStability: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    
    biasHistory: {
      type: [BiasHistorySchema],
      default: [],
    },
    
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'user_bias',
  }
);

export const UserBiasModel = mongoose.model<IUserBias>(
  'UserBias',
  UserBiasSchema
);

/**
 * Bias bounds
 */
export const BIAS_BOUNDS = {
  min: -0.5,
  max: 0.5,
};

/**
 * Cold start clusters with average bias vectors
 */
export const COLD_START_CLUSTERS: Record<string, BiasVector> = {
  conservative: {
    strategy: { accumulator: 0.1, holder: 0.15 },
    risk: -0.2,
    volatility: -0.15,
    influence: 0.1,
    momentum: -0.1,
  },
  aggressive: {
    strategy: { whale: 0.15, trader: 0.1 },
    risk: 0.2,
    volatility: 0.2,
    influence: 0.15,
    momentum: 0.1,
  },
  neutral: {
    strategy: {},
    risk: 0,
    volatility: 0,
    influence: 0,
    momentum: 0,
  },
};

/**
 * Clamp bias value within bounds
 */
export function clampBias(value: number): number {
  return Math.max(BIAS_BOUNDS.min, Math.min(BIAS_BOUNDS.max, value));
}

/**
 * Calculate confidence from evidence count
 * More evidence = higher confidence
 */
export function calculateBiasConfidence(evidenceCount: number): number {
  // Asymptotic approach to 1.0
  // 10 events = ~0.63, 50 events = ~0.99
  return 1 - Math.exp(-evidenceCount / 20);
}

/**
 * Calculate bias saturation
 * 0 = cold start (needs more data)
 * 1 = fully saturated (stable, can reduce LR)
 */
export function calculateBiasSaturation(evidenceCount: number, biasStability: number): number {
  // Saturation based on evidence count and stability
  const evidenceFactor = 1 - Math.exp(-evidenceCount / 50); // ~0.86 at 100 events
  const stabilityFactor = biasStability;
  return Math.min(1, evidenceFactor * 0.7 + stabilityFactor * 0.3);
}

/**
 * Get effective learning rate based on saturation
 * High saturation = lower learning rate (user is "trained")
 */
export function getEffectiveBiasLearningRate(baseLR: number, saturation: number): number {
  // At saturation=1, LR drops to 30% of base
  const saturationFactor = 1 - saturation * 0.7;
  return baseLR * saturationFactor;
}
