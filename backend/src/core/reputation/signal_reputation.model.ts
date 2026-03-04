/**
 * Signal Reputation Model (Phase 15.1)
 * 
 * Evaluates the quality and reliability of specific signals based on historical performance.
 * Answers: "Why should I trust this signal?"
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISignalReputation extends Document {
  _id: Types.ObjectId;
  
  // Signal reference
  signalId: Types.ObjectId;
  
  // Core metrics
  successRate: number;              // % of confirmed reactions (0-100)
  avgPriceImpact: number;           // Average % price movement
  volatilityAdjusted: number;       // Success rate adjusted for market volatility
  decayScore: number;               // Time decay factor (0-1)
  
  // Trust score (0-100)
  trustScore: number;
  
  // Supporting data
  sampleSize: number;               // Number of reactions measured
  consistency: number;              // Variance in outcomes (0-100)
  
  // Regime breakdown
  regimePerformance: {
    trend_up: number;               // Success rate in trending up
    trend_down: number;             // Success rate in trending down
    range: number;                  // Success rate in ranging markets
    high_volatility: number;        // Success rate in high vol
  };
  
  // Difficulty bonus
  regimeDifficultyBonus: number;    // Bonus for performing in hard regimes
  
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

const SignalReputationSchema = new Schema<ISignalReputation>(
  {
    signalId: {
      type: Schema.Types.ObjectId,
      ref: 'Signal',
      required: true,
      unique: true,
      index: true,
    },
    
    successRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },
    
    avgPriceImpact: {
      type: Number,
      required: true,
    },
    
    volatilityAdjusted: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    
    decayScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    
    trustScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
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
    
    regimePerformance: {
      type: RegimePerformanceSchema,
      default: {},
    },
    
    regimeDifficultyBonus: {
      type: Number,
      default: 0,
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
    collection: 'signal_reputation',
  }
);

// Indexes
SignalReputationSchema.index({ trustScore: -1, sampleSize: -1 });
SignalReputationSchema.index({ successRate: -1 });

export const SignalReputationModel = mongoose.model<ISignalReputation>(
  'SignalReputation',
  SignalReputationSchema
);

/**
 * Trust score formula weights
 */
export const SIGNAL_TRUST_WEIGHTS = {
  successRate: 0.45,
  avgPriceImpact: 0.30,
  regimeDifficultyBonus: 0.15,
  consistency: 0.10,
};

/**
 * Minimum sample size for reliable trust score
 */
export const MIN_SIGNAL_SAMPLE_SIZE = 5;

/**
 * Time decay half-life (days)
 */
export const SIGNAL_DECAY_HALFLIFE = 30;
