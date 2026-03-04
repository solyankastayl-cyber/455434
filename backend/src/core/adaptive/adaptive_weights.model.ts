/**
 * Adaptive Weights Model (Phase 12A.1 - Adaptive Weights Engine)
 * 
 * Stores and manages adaptive weights for scores, decisions, and confidence.
 * Weights adjust within a safe corridor (±25%) based on feedback.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';
import { env, ADAPTIVE_VERSION } from '../../config/env.js';

/**
 * Weight scope - what level this weight applies to
 */
export type WeightScope = 'global' | 'strategy' | 'decision_type';

/**
 * Weight target - what calculation this weight affects
 */
export type WeightTarget = 'score' | 'decision' | 'confidence';

/**
 * Adaptive Weight Document Interface
 */
export interface IAdaptiveWeight extends Document {
  _id: Types.ObjectId;
  
  // Version tracking
  adaptiveVersion: string;
  
  // Identification
  scope: WeightScope;
  scopeId: string;  // 'global' | strategy type | decision type
  target: WeightTarget;
  key: string;  // e.g., 'intensity', 'risk', 'influence', 'accuracy'
  
  // Weight values
  baseWeight: number;       // Original weight from Phase 6
  currentWeight: number;    // Adaptive weight
  minWeight: number;        // Floor (base * 0.75)
  maxWeight: number;        // Ceiling (base * 1.25)
  
  // Learning state
  evidenceCount: number;    // Number of feedback events used
  totalPositive: number;    // Cumulative positive feedback
  totalNegative: number;    // Cumulative negative feedback
  
  // Drift tracking
  driftFromBase: number;    // currentWeight - baseWeight
  cumulativeDrift: number;  // currentWeight / baseWeight (ratio)
  driftDirection: 'up' | 'down' | 'stable';
  hitBoundaryCount: number; // Times weight hit min/max
  frozen: boolean;          // True if cumulative drift hit hard cap
  frozenAt?: Date;
  frozenReason?: string;
  
  // Audit
  lastAdjustment: number;   // Last delta applied
  lastAdjustmentAt: Date;
  adjustmentHistory: {
    timestamp: Date;
    oldWeight: number;
    newWeight: number;
    reason: string;
    feedbackScore: number;
    adaptiveVersion: string;
  }[];
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Adjustment History Schema
 */
const AdjustmentHistorySchema = new Schema(
  {
    timestamp: { type: Date, required: true },
    oldWeight: { type: Number, required: true },
    newWeight: { type: Number, required: true },
    reason: { type: String, required: true },
    feedbackScore: { type: Number, required: true },
    adaptiveVersion: { type: String, default: ADAPTIVE_VERSION },
  },
  { _id: false }
);

/**
 * Adaptive Weight Schema
 */
const AdaptiveWeightSchema = new Schema<IAdaptiveWeight>(
  {
    // Version
    adaptiveVersion: {
      type: String,
      default: ADAPTIVE_VERSION,
      index: true,
    },
    
    // Identification
    scope: {
      type: String,
      enum: ['global', 'strategy', 'decision_type'],
      required: true,
      index: true,
    },
    scopeId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    target: {
      type: String,
      enum: ['score', 'decision', 'confidence'],
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      index: true,
    },
    
    // Weights
    baseWeight: {
      type: Number,
      required: true,
    },
    currentWeight: {
      type: Number,
      required: true,
    },
    minWeight: {
      type: Number,
      required: true,
    },
    maxWeight: {
      type: Number,
      required: true,
    },
    
    // Learning state
    evidenceCount: {
      type: Number,
      default: 0,
    },
    totalPositive: {
      type: Number,
      default: 0,
    },
    totalNegative: {
      type: Number,
      default: 0,
    },
    
    // Drift
    driftFromBase: {
      type: Number,
      default: 0,
    },
    cumulativeDrift: {
      type: Number,
      default: 1.0,  // ratio: currentWeight / baseWeight
    },
    driftDirection: {
      type: String,
      enum: ['up', 'down', 'stable'],
      default: 'stable',
    },
    hitBoundaryCount: {
      type: Number,
      default: 0,
    },
    frozen: {
      type: Boolean,
      default: false,
    },
    frozenAt: {
      type: Date,
    },
    frozenReason: {
      type: String,
    },
    
    // Audit
    lastAdjustment: {
      type: Number,
      default: 0,
    },
    lastAdjustmentAt: {
      type: Date,
    },
    adjustmentHistory: {
      type: [AdjustmentHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'adaptive_weights',
  }
);

// Compound unique index
AdaptiveWeightSchema.index(
  { scope: 1, scopeId: 1, target: 1, key: 1 },
  { unique: true }
);

export const AdaptiveWeightModel = mongoose.model<IAdaptiveWeight>(
  'AdaptiveWeight',
  AdaptiveWeightSchema
);

/**
 * Default base weights from Phase 6
 */
export const BASE_SCORE_WEIGHTS: Record<string, number> = {
  behavior: 0.25,
  intensity: 0.25,
  consistency: 0.20,
  risk: -0.20,      // Negative weight
  influence: 0.20,
};

/**
 * Decision weights
 */
export const BASE_DECISION_WEIGHTS: Record<string, number> = {
  accuracy: 0.40,
  consistency: 0.20,
  timeliness: 0.15,
  feedback: 0.25,
};

/**
 * Get weight corridor bounds
 */
export function getWeightBounds(baseWeight: number): { min: number; max: number } {
  const corridor = env.ADAPTIVE_WEIGHT_CORRIDOR; // 0.25 = ±25%
  const absBase = Math.abs(baseWeight);
  const margin = absBase * corridor;
  
  // Handle negative weights (like risk)
  if (baseWeight < 0) {
    return {
      min: baseWeight - margin,  // More negative
      max: baseWeight + margin,  // Less negative
    };
  }
  
  return {
    min: baseWeight - margin,
    max: baseWeight + margin,
  };
}

/**
 * Clamp weight within bounds
 */
export function clampWeight(weight: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, weight));
}

/**
 * Check if cumulative drift exceeds hard cap
 * Returns true if weight should be frozen
 */
export function checkCumulativeDriftCap(currentWeight: number, baseWeight: number): {
  shouldFreeze: boolean;
  cumulativeDrift: number;
  reason?: string;
} {
  const driftCap = env.ADAPTIVE_CUMULATIVE_DRIFT_CAP; // 1.25 default
  const absBase = Math.abs(baseWeight);
  
  if (absBase === 0) {
    return { shouldFreeze: false, cumulativeDrift: 1 };
  }
  
  const cumulativeDrift = Math.abs(currentWeight / baseWeight);
  
  if (cumulativeDrift > driftCap) {
    return {
      shouldFreeze: true,
      cumulativeDrift,
      reason: `Cumulative drift ${cumulativeDrift.toFixed(3)} exceeds cap ${driftCap}`,
    };
  }
  
  // Also check if drift is below inverse cap (for negative weights going less negative)
  if (cumulativeDrift < (1 / driftCap)) {
    return {
      shouldFreeze: true,
      cumulativeDrift,
      reason: `Cumulative drift ${cumulativeDrift.toFixed(3)} below inverse cap ${(1/driftCap).toFixed(3)}`,
    };
  }
  
  return { shouldFreeze: false, cumulativeDrift };
}

/**
 * Adaptive Signal Types for Phase 13 preparation
 */
export interface AdaptiveInput {
  feedbackSignals: {
    rating: number;
    outcome?: 'positive' | 'negative' | 'neutral';
    tags?: string[];
  }[];
  virtualPerformance: {
    simulationId: string;
    outcome: 'positive' | 'negative' | 'neutral';
    roi?: number;
  }[];
  trustDelta: number;
}

export interface DecisionImpact {
  weightDelta: Record<string, number>;
  confidenceDelta: number;
  reason: string;
  adaptiveVersion: string;
}

/**
 * Calculate decision impact from adaptive input
 */
export function calculateDecisionImpact(input: AdaptiveInput): DecisionImpact {
  const weightDelta: Record<string, number> = {};
  let confidenceDelta = 0;
  
  // Process feedback signals
  for (const fb of input.feedbackSignals) {
    const score = (fb.rating - 3) / 2; // 1→-1, 3→0, 5→+1
    weightDelta.accuracy = (weightDelta.accuracy || 0) + score * env.ADAPTIVE_LEARNING_RATE;
    confidenceDelta += score * 0.01;
  }
  
  // Process virtual performance
  for (const perf of input.virtualPerformance) {
    const score = perf.outcome === 'positive' ? 1 : perf.outcome === 'negative' ? -1 : 0;
    weightDelta.accuracy = (weightDelta.accuracy || 0) + score * env.ADAPTIVE_LEARNING_RATE * 0.5;
    confidenceDelta += score * 0.02;
  }
  
  // Apply trust delta
  confidenceDelta += input.trustDelta * 0.01;
  
  return {
    weightDelta,
    confidenceDelta,
    reason: `Processed ${input.feedbackSignals.length} feedback, ${input.virtualPerformance.length} simulations`,
    adaptiveVersion: ADAPTIVE_VERSION,
  };
}
