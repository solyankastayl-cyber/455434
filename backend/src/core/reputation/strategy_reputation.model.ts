/**
 * Strategy Reputation Model (Phase 15.2)
 * 
 * Evaluates strategy effectiveness across market conditions.
 * Answers: "Does this strategy actually work?"
 */
import mongoose, { Schema, Document } from 'mongoose';
import { StrategyType } from '../strategies/strategy_profiles.model.js';

export type ReliabilityTier = 'A' | 'B' | 'C' | 'D';

export interface IStrategyReputation extends Document {
  strategyType: StrategyType;
  
  // Core metrics
  totalSignals: number;
  confirmedSignals: number;
  successRate: number;              // % confirmed (0-100)
  avgPnL: number;                   // Average profit/loss %
  
  // Regime breakdown
  regimePerformance: {
    trend_up: number;               // Success rate in up trends
    trend_down: number;             // Success rate in down trends
    range: number;                  // Success rate in ranging
    high_volatility: number;        // Success rate in high vol
  };
  
  // Quality metrics
  trustScore: number;               // 0-100
  confidence: number;               // Statistical confidence (0-1)
  consistency: number;              // Outcome variance (0-100)
  
  // Volume confidence
  signalVolumeConfidence: number;   // Based on sample size (0-1)
  
  // Regime-adjusted performance
  regimeAdjustedPerformance: number; // Weighted by regime difficulty
  
  // Reliability tier
  reliabilityTier: ReliabilityTier;
  
  // Metadata
  lastUpdatedAt: Date;
  computedAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const RegimePerformanceSchema = new Schema(
  {
    trend_up: { type: Number, default: 0 },
    trend_down: { type: Number, default: 0 },
    range: { type: Number, default: 0 },
    high_volatility: { type: Number, default: 0 },
  },
  { _id: false }
);

const StrategyReputationSchema = new Schema<IStrategyReputation>(
  {
    strategyType: {
      type: String,
      required: true,
      unique: true,
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
    
    successRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },
    
    avgPnL: {
      type: Number,
      required: true,
    },
    
    regimePerformance: {
      type: RegimePerformanceSchema,
      default: {},
    },
    
    trustScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },
    
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    
    consistency: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    
    signalVolumeConfidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    
    regimeAdjustedPerformance: {
      type: Number,
      required: true,
    },
    
    reliabilityTier: {
      type: String,
      enum: ['A', 'B', 'C', 'D'],
      required: true,
      index: true,
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
    collection: 'strategy_reputation',
  }
);

// Indexes
StrategyReputationSchema.index({ trustScore: -1, reliabilityTier: 1 });
StrategyReputationSchema.index({ successRate: -1 });

export const StrategyReputationModel = mongoose.model<IStrategyReputation>(
  'StrategyReputation',
  StrategyReputationSchema
);

/**
 * Strategy trust score formula weights
 */
export const STRATEGY_TRUST_WEIGHTS = {
  successRate: 0.35,
  regimeAdjustedPerformance: 0.30,
  consistency: 0.20,
  signalVolumeConfidence: 0.15,
};

/**
 * Reliability tier thresholds
 */
export const RELIABILITY_TIERS: Record<ReliabilityTier, [number, number]> = {
  'A': [80, 100],   // Excellent
  'B': [60, 79],    // Good
  'C': [40, 59],    // Fair
  'D': [0, 39],     // Poor
};

/**
 * Get reliability tier from trust score
 */
export function getReliabilityTier(trustScore: number): ReliabilityTier {
  if (trustScore >= 80) return 'A';
  if (trustScore >= 60) return 'B';
  if (trustScore >= 40) return 'C';
  return 'D';
}

/**
 * Minimum sample size for reliable strategy reputation
 */
export const MIN_STRATEGY_SAMPLE_SIZE = 20;
