/**
 * Follow Events MongoDB Model
 * 
 * User's inbox: events that matched their follow rules.
 * This is what the user sees in their notifications/alerts.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Event source types
 */
export type FollowEventSourceType = 'strategy_signal' | 'signal' | 'score_change';

/**
 * Follow Event Document Interface
 */
export interface IFollowEvent extends Document {
  _id: Types.ObjectId;
  
  // User
  userId: string;
  
  // Source reference
  source: {
    sourceType: FollowEventSourceType;
    sourceId: string;  // ObjectId of the source signal/score
  };
  
  // Signal data snapshot
  targetType: string;   // actor, entity, strategy, token
  targetId: string;     // The address/id that triggered
  severity: number;
  confidence: number;
  
  // Display content
  title: string;
  message: string;
  
  // Read status
  readAt: Date | null;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Source Schema
 */
const SourceSchema = new Schema(
  {
    sourceType: {
      type: String,
      enum: ['strategy_signal', 'signal', 'score_change'],
      required: true,
    },
    sourceId: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

/**
 * Follow Event Schema
 */
const FollowEventSchema = new Schema<IFollowEvent>(
  {
    // User
    userId: {
      type: String,
      required: true,
      index: true,
    },
    
    // Source
    source: {
      type: SourceSchema,
      required: true,
    },
    
    // Target info
    targetType: {
      type: String,
      required: true,
    },
    targetId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Scores
    severity: {
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
    
    // Display
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    
    // Read status
    readAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'follow_events',
  }
);

// ========== INDEXES ==========

// User's inbox (latest first)
FollowEventSchema.index({ userId: 1, createdAt: -1 });

// Unread events
FollowEventSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

// For dedup (prevent duplicate events)
FollowEventSchema.index(
  { userId: 1, 'source.sourceType': 1, 'source.sourceId': 1 },
  { unique: true }
);

// For severity filtering
FollowEventSchema.index({ userId: 1, severity: -1 });

export const FollowEventModel = mongoose.model<IFollowEvent>('FollowEvent', FollowEventSchema);
