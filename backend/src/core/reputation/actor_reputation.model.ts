/**
 * Actor Reputation Model (Phase 15.3)
 * 
 * Evaluates actor reliability and performance across market conditions.
 * Answers: "Is this actor actually making money or just making noise?"
 */
import mongoose, { Schema, Document } from 'mongoose';

export type ActorReliabilityTier = 'A' | 'B' | 'C' | 'D';

export interface IActorReputation extends Document {
  // Actor reference
  address: string;
  
  // Strategy mix
  strategyMix: {
    accumulation: number;           // % of signals
    distribution: number;
    rotation: number;
    other: number;
  };
  
  // Performance metrics
  historicalAccuracy: number;       // % of successful signals (0-100)
  avgSignalImpact: number;          // Average price impact %
  avgImpactAdjusted: number;        // Impact adjusted for market conditions
  
  // Risk metrics
  drawdown: number;                 // Max drawdown %
  riskAdjustedReturn: number;       // Return / risk ratio
  
  // Regime strengths
  regimeStrengths: {
    trend_up: number;               // Performance score in up trends
    trend_down: number;             // Performance score in down trends
    range: number;                  // Performance score in ranging
    high_volatility: number;        // Performance score in high vol
  };
  
  // Regime fit score
  regimeFit: number;                // How well actor adapts to regimes (0-100)
  
  // Trust score (0-100)
  trustScore: number;
  
  // Reliability tier
  reliabilityTier: ActorReliabilityTier;
  
  // Supporting data
  totalSignals: number;
  confirmedSignals: number;
  sampleSize: number;
  
  // Quality indicators
  consistency: number;              // Signal consistency (0-100)
  confidence: number;               // Statistical confidence (0-1)
  
  // Metadata
  lastUpdatedAt: Date;
  computedAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const StrategyMixSchema = new Schema(
  {
    accumulation: { type: Number, default: 0 },
    distribution: { type: Number, default: 0 },
    rotation: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
  },
  { _id: false }
);

const RegimeStrengthsSchema = new Schema(
  {
    trend_up: { type: Number, default: 0 },
    trend_down: { type: Number, default: 0 },
    range: { type: Number, default: 0 },
    high_volatility: { type: Number, default: 0 },
  },
  { _id: false }
);

const ActorReputationSchema = new Schema<IActorReputation>(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    
    strategyMix: {
      type: StrategyMixSchema,
      default: {},
    },
    
    historicalAccuracy: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },
    
    avgSignalImpact: {
      type: Number,
      required: true,
    },
    
    avgImpactAdjusted: {
      type: Number,
      required: true,
    },
    
    drawdown: {
      type: Number,
      required: true,
    },
    
    riskAdjustedReturn: {
      type: Number,
      required: true,
    },
    
    regimeStrengths: {
      type: RegimeStrengthsSchema,
      default: {},
    },
    
    regimeFit: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    
    trustScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },
    
    reliabilityTier: {
      type: String,
      enum: ['A', 'B', 'C', 'D'],
      required: true,
      index: true,
    },
    
    totalSignals: {
      type: Number,
      required: true,
      min: 0,
    },
    
    confirmedSignals: {
      type: Number,
      required: true,
      min: 0,
    },
    
    sampleSize: {
      type: Number,
      required: true,
      min: 0,
    },
    
    consistency: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    
    lastUpdatedAt: {
      type: Date,
      required: true,
    },
    
    computedAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'actor_reputation',
  }
);

// Indexes
ActorReputationSchema.index({ trustScore: -1, reliabilityTier: 1 });
ActorReputationSchema.index({ historicalAccuracy: -1 });
ActorReputationSchema.index({ riskAdjustedReturn: -1 });

export const ActorReputationModel = mongoose.model<IActorReputation>(
  'ActorReputation',
  ActorReputationSchema
);

/**
 * Actor trust score formula weights
 */
export const ACTOR_TRUST_WEIGHTS = {
  historicalAccuracy: 0.30,
  avgImpactAdjusted: 0.25,
  regimeFit: 0.20,
  riskAdjustedReturn: 0.15,
  drawdownPenalty: 0.10,
};

/**
 * Get reliability tier from trust score
 */
export function getActorReliabilityTier(trustScore: number): ActorReliabilityTier {
  if (trustScore >= 80) return 'A';
  if (trustScore >= 60) return 'B';
  if (trustScore >= 40) return 'C';
  return 'D';
}

/**
 * Minimum sample size for reliable actor reputation
 */
export const MIN_ACTOR_SAMPLE_SIZE = 15;
