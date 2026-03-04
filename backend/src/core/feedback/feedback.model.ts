/**
 * Feedback MongoDB Model (L11.4 - Feedback Loop)
 * 
 * Collects user feedback on decisions and actions.
 * Used to improve decision quality over time.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Feedback type
 */
export type FeedbackType = 'decision' | 'action' | 'simulation';

/**
 * Feedback rating
 */
export type FeedbackRating = 1 | 2 | 3 | 4 | 5;

/**
 * Feedback outcome
 */
export type FeedbackOutcome = 'followed' | 'ignored' | 'partial' | 'pending';

/**
 * Feedback Document Interface
 */
export interface IFeedback extends Document {
  _id: Types.ObjectId;
  
  // Source
  feedbackType: FeedbackType;
  sourceId: string;  // decisionId, actionId, or simulationId
  
  // Target
  targetType: 'actor' | 'strategy' | 'signal';
  targetId: string;
  
  // User
  userId: string;
  
  // Feedback
  rating?: FeedbackRating;  // 1-5 stars
  outcome: FeedbackOutcome;
  
  // Details
  helpful?: boolean;
  accurate?: boolean;
  timely?: boolean;
  
  // Free text
  comments?: string;
  tags?: string[];  // e.g., ['too_late', 'wrong_direction', 'perfect_timing']
  
  // Context at feedback time
  context: {
    decisionType?: string;
    actionType?: string;
    originalConfidence?: number;
    actualPriceChange?: number;
    actualScoreChange?: number;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Context Schema
 */
const ContextSchema = new Schema(
  {
    decisionType: String,
    actionType: String,
    originalConfidence: Number,
    actualPriceChange: Number,
    actualScoreChange: Number,
  },
  { _id: false }
);

/**
 * Feedback Schema
 */
const FeedbackSchema = new Schema<IFeedback>(
  {
    // Source
    feedbackType: {
      type: String,
      enum: ['decision', 'action', 'simulation'],
      required: true,
      index: true,
    },
    sourceId: {
      type: String,
      required: true,
      index: true,
    },
    
    // Target
    targetType: {
      type: String,
      enum: ['actor', 'strategy', 'signal'],
      required: true,
    },
    targetId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // User
    userId: {
      type: String,
      required: true,
      index: true,
    },
    
    // Feedback
    rating: {
      type: Number,
      min: 1,
      max: 5,
    },
    outcome: {
      type: String,
      enum: ['followed', 'ignored', 'partial', 'pending'],
      default: 'pending',
    },
    
    // Details
    helpful: Boolean,
    accurate: Boolean,
    timely: Boolean,
    
    // Free text
    comments: {
      type: String,
      maxlength: 1000,
    },
    tags: {
      type: [String],
      default: [],
    },
    
    // Context
    context: {
      type: ContextSchema,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'feedback',
  }
);

// Indexes
FeedbackSchema.index({ userId: 1, feedbackType: 1, createdAt: -1 });
FeedbackSchema.index({ sourceId: 1, userId: 1 }, { unique: true });
FeedbackSchema.index({ targetId: 1, outcome: 1 });
FeedbackSchema.index({ rating: 1 });

export const FeedbackModel = mongoose.model<IFeedback>('Feedback', FeedbackSchema);

/**
 * Common feedback tags
 */
export const FEEDBACK_TAGS = [
  'perfect_timing',
  'too_late',
  'too_early',
  'wrong_direction',
  'missed_opportunity',
  'saved_money',
  'unclear_rationale',
  'helpful_insight',
  'already_knew',
  'contradicted_research',
];
