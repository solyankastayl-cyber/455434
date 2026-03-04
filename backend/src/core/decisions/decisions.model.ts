/**
 * Decisions MongoDB Model (L11.1 - Decision Engine)
 * 
 * Transforms analytics into actionable decisions.
 * "System explains → user decides → system tracks outcome"
 * 
 * Uses data from L5-L10, adds decision logic.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Decision scope
 */
export type DecisionScope = 'actor' | 'strategy' | 'signal';

/**
 * Decision types
 */
export type DecisionType =
  | 'follow'           // Add to watchlist with alerts
  | 'copy'             // Copy strategy/actor behavior
  | 'watch'            // Monitor without action
  | 'ignore'           // Skip, not relevant
  | 'reduce_exposure'  // Decrease allocation
  | 'increase_exposure'; // Increase allocation

/**
 * Risk level
 */
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Timeframe
 */
export type Timeframe = 'short' | 'mid' | 'long';

/**
 * Decision Document Interface
 */
export interface IDecision extends Document {
  _id: Types.ObjectId;
  
  // Target
  scope: DecisionScope;
  refId: string;  // address | strategyType | signalId
  
  // Decision
  decisionType: DecisionType;
  confidence: number;  // 0-1
  rationale: string[];  // Human-readable reasons
  riskLevel: RiskLevel;
  
  // Allocation suggestion
  suggestedAllocation?: number;  // % of portfolio
  timeframe: Timeframe;
  
  // Context
  context: {
    strategyType?: string;
    compositeScore?: number;
    tier?: string;
    recentSignals?: string[];
  };
  
  // Validity
  validUntil: Date;
  supersededBy?: string;  // Newer decision ID
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Context Schema
 */
const ContextSchema = new Schema(
  {
    strategyType: String,
    compositeScore: Number,
    tier: String,
    recentSignals: [String],
  },
  { _id: false }
);

/**
 * Decision Schema
 */
const DecisionSchema = new Schema<IDecision>(
  {
    // Target
    scope: {
      type: String,
      enum: ['actor', 'strategy', 'signal'],
      required: true,
      index: true,
    },
    refId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Decision
    decisionType: {
      type: String,
      enum: ['follow', 'copy', 'watch', 'ignore', 'reduce_exposure', 'increase_exposure'],
      required: true,
      index: true,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    rationale: {
      type: [String],
      required: true,
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
      index: true,
    },
    
    // Allocation
    suggestedAllocation: {
      type: Number,
      min: 0,
      max: 100,
    },
    timeframe: {
      type: String,
      enum: ['short', 'mid', 'long'],
      required: true,
    },
    
    // Context
    context: {
      type: ContextSchema,
      default: {},
    },
    
    // Validity
    validUntil: {
      type: Date,
      required: true,
      index: true,
    },
    supersededBy: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'decisions',
  }
);

// Indexes
DecisionSchema.index({ scope: 1, refId: 1, createdAt: -1 });
DecisionSchema.index({ decisionType: 1, confidence: -1 });
DecisionSchema.index({ validUntil: 1 });

export const DecisionModel = mongoose.model<IDecision>('Decision', DecisionSchema);

/**
 * Decision validity periods (hours)
 */
export const DECISION_VALIDITY_HOURS: Record<DecisionType, number> = {
  'follow': 72,
  'copy': 48,
  'watch': 24,
  'ignore': 168,  // 1 week
  'reduce_exposure': 24,
  'increase_exposure': 24,
};

/**
 * Decision type display names
 */
export const DECISION_TYPE_NAMES: Record<DecisionType, string> = {
  'follow': 'Follow',
  'copy': 'Copy Strategy',
  'watch': 'Watch Closely',
  'ignore': 'Ignore',
  'reduce_exposure': 'Reduce Exposure',
  'increase_exposure': 'Increase Exposure',
};
