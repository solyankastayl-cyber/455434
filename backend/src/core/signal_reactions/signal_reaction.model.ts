/**
 * Signal Market Reaction Model (Phase 14B.1)
 * 
 * Tracks how the market reacted to each signal.
 * Validates signals against actual market movements.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type ReactionWindow = '5m' | '15m' | '1h' | '4h';
export type ReactionType = 'confirmed' | 'neutral' | 'failed';

export interface ISignalReaction extends Document {
  _id: Types.ObjectId;
  
  // Signal reference
  signalId: Types.ObjectId;
  
  // Asset being tracked
  assetAddress: string;
  chain: string;
  
  // Reaction window
  reactionWindow: ReactionWindow;
  
  // Price data
  priceBefore: number;
  priceAfter: number;
  priceDeltaPct: number;
  priceTimestampBefore: Date;
  priceTimestampAfter: Date;
  
  // Volume/volatility changes
  volatilityBefore: number;
  volatilityAfter: number;
  volatilityDeltaPct: number;
  
  // Reaction classification
  reactionType: ReactionType;
  directionMatched: boolean;          // Did price move in expected direction?
  magnitudeSignificant: boolean;      // Was the move significant?
  
  // Impact on confidence
  confidenceImpact: number;           // -1 to +1
  
  // Signal context
  signalType: string;
  signalSeverity: number;
  signalConfidenceOriginal: number;
  
  // Computation metadata
  computedAt: Date;
  priceSourceBefore: string;
  priceSourceAfter: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const SignalReactionSchema = new Schema<ISignalReaction>(
  {
    signalId: {
      type: Schema.Types.ObjectId,
      ref: 'Signal',
      required: true,
      index: true,
    },
    
    assetAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    chain: {
      type: String,
      required: true,
      default: 'ethereum',
    },
    
    reactionWindow: {
      type: String,
      enum: ['5m', '15m', '1h', '4h'],
      required: true,
      index: true,
    },
    
    priceBefore: { type: Number, required: true },
    priceAfter: { type: Number, required: true },
    priceDeltaPct: { type: Number, required: true },
    priceTimestampBefore: { type: Date, required: true },
    priceTimestampAfter: { type: Date, required: true },
    
    volatilityBefore: { type: Number, default: 0 },
    volatilityAfter: { type: Number, default: 0 },
    volatilityDeltaPct: { type: Number, default: 0 },
    
    reactionType: {
      type: String,
      enum: ['confirmed', 'neutral', 'failed'],
      required: true,
      index: true,
    },
    directionMatched: { type: Boolean, required: true },
    magnitudeSignificant: { type: Boolean, required: true },
    
    confidenceImpact: {
      type: Number,
      required: true,
      min: -1,
      max: 1,
    },
    
    signalType: { type: String, required: true },
    signalSeverity: { type: Number, required: true },
    signalConfidenceOriginal: { type: Number, required: true },
    
    computedAt: { type: Date, required: true },
    priceSourceBefore: { type: String, default: 'price_points' },
    priceSourceAfter: { type: String, default: 'price_points' },
  },
  {
    timestamps: true,
    collection: 'signal_reactions',
  }
);

// Indexes
SignalReactionSchema.index({ signalId: 1, reactionWindow: 1 }, { unique: true });
SignalReactionSchema.index({ assetAddress: 1, computedAt: -1 });
SignalReactionSchema.index({ reactionType: 1, computedAt: -1 });
SignalReactionSchema.index({ signalType: 1, reactionType: 1 });

export const SignalReactionModel = mongoose.model<ISignalReaction>(
  'SignalReaction',
  SignalReactionSchema
);

/**
 * Reaction thresholds
 */
export const REACTION_THRESHOLDS = {
  // Minimum price change to be considered significant
  significantMovePct: 1.5,      // 1.5%
  
  // Below this is noise
  noiseThresholdPct: 0.3,      // 0.3%
  
  // Confidence impact values
  confirmedImpact: 0.15,       // +15% confidence for confirmed
  neutralImpact: 0,            // No change for neutral
  failedImpact: -0.2,          // -20% confidence for failed
  
  // Volatility threshold for high volatility discount
  highVolatilityPct: 5,        // 5% volatility = high
};

/**
 * Get window duration in milliseconds
 */
export function getWindowMs(window: ReactionWindow): number {
  const durations: Record<ReactionWindow, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
  };
  return durations[window];
}

/**
 * Determine expected price direction based on signal type
 */
export function getExpectedDirection(signalType: string): 'up' | 'down' | 'any' {
  const bullishSignals = [
    'accumulation_start',
    'intensity_spike',
  ];
  
  const bearishSignals = [
    'distribution_start',
    'intensity_drop',
    'wash_detected',
  ];
  
  if (bullishSignals.includes(signalType)) return 'up';
  if (bearishSignals.includes(signalType)) return 'down';
  return 'any';
}
