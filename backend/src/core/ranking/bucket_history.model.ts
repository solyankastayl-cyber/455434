/**
 * Token Bucket History Model (Block D - D3)
 * 
 * Tracks all bucket transitions for:
 * - Stability analysis
 * - User trust (transparency)
 * - Outcome Loop (Block F)
 * - ML training data
 */
import mongoose, { Schema } from 'mongoose';

export type BucketType = 'BUY' | 'WATCH' | 'SELL';

export type BucketChangeReason =
  | 'score_increase'
  | 'score_decrease'
  | 'confidence_up'
  | 'confidence_down'
  | 'risk_spike'
  | 'risk_normalized'
  | 'actor_signal_positive'
  | 'actor_signal_negative'
  | 'conflict_lock'
  | 'conflict_resolved'
  | 'coverage_improved'
  | 'coverage_degraded'
  | 'initial_assignment';

export interface IBucketHistory {
  tokenAddress: string;
  symbol: string;
  chainId: number;
  
  // Transition details
  fromBucket: BucketType | null; // null for initial assignment
  toBucket: BucketType;
  reason: BucketChangeReason;
  
  // Metrics at time of transition
  compositeScore: number;
  confidence: number;
  risk: number;
  actorSignalScore?: number;
  conflictScore?: number;
  
  // Additional context
  engineMode: 'rules_only' | 'rules_with_actors' | 'rules_with_ml';
  coverage: number;
  
  // Timing
  timestamp: Date;
  
  // Metadata
  transitionId: string; // Unique ID for this transition
  prevTransitionId?: string; // Link to previous transition
}

const BucketHistorySchema = new Schema<IBucketHistory>({
  tokenAddress: { type: String, required: true, lowercase: true, index: true },
  symbol: { type: String, required: true, index: true },
  chainId: { type: Number, required: true, default: 1 },
  
  fromBucket: { 
    type: String, 
    enum: ['BUY', 'WATCH', 'SELL', null],
    default: null,
  },
  toBucket: { 
    type: String, 
    enum: ['BUY', 'WATCH', 'SELL'],
    required: true,
    index: true,
  },
  reason: {
    type: String,
    enum: [
      'score_increase', 'score_decrease',
      'confidence_up', 'confidence_down',
      'risk_spike', 'risk_normalized',
      'actor_signal_positive', 'actor_signal_negative',
      'conflict_lock', 'conflict_resolved',
      'coverage_improved', 'coverage_degraded',
      'initial_assignment',
    ],
    required: true,
  },
  
  compositeScore: { type: Number, required: true },
  confidence: { type: Number, required: true },
  risk: { type: Number, required: true },
  actorSignalScore: { type: Number },
  conflictScore: { type: Number },
  
  engineMode: {
    type: String,
    enum: ['rules_only', 'rules_with_actors', 'rules_with_ml'],
    required: true,
  },
  coverage: { type: Number, required: true },
  
  timestamp: { type: Date, default: Date.now, index: true },
  
  transitionId: { type: String, required: true, unique: true },
  prevTransitionId: { type: String },
}, {
  collection: 'bucket_history',
  timestamps: false, // Using custom timestamp field
});

// Compound indexes for queries
BucketHistorySchema.index({ tokenAddress: 1, timestamp: -1 });
BucketHistorySchema.index({ toBucket: 1, timestamp: -1 });
BucketHistorySchema.index({ fromBucket: 1, toBucket: 1, timestamp: -1 });

export const BucketHistoryModel = mongoose.model<IBucketHistory>('BucketHistory', BucketHistorySchema);
