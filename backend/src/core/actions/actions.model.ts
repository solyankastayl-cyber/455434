/**
 * Actions MongoDB Model (L11.2 - Action Suggestions)
 * 
 * Copy / Follow Logic - suggested actions based on decisions.
 * User remains in control - only suggestions, not auto-trading.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Action types
 */
export type ActionType =
  | 'copy_strategy'   // Copy actor's strategy
  | 'copy_actor'      // Mirror actor's moves
  | 'track_signal'    // Set up tracking for signal type
  | 'set_alert'       // Create alert rule
  | 'add_watchlist';  // Add to watchlist

/**
 * Action status
 */
export type ActionStatus = 'suggested' | 'accepted' | 'dismissed' | 'expired';

/**
 * Action Document Interface
 */
export interface IAction extends Document {
  _id: Types.ObjectId;
  
  // Source decision
  decisionId: string;
  
  // Action details
  actionType: ActionType;
  
  // Target info
  targetType: 'actor' | 'strategy' | 'signal';
  targetId: string;
  
  // Suggestions
  suggestedAssets?: string[];  // Asset addresses
  suggestedAmountRange?: [number, number];  // [min, max] in USD or %
  
  // Confidence
  confidence: number;  // 0-1
  riskLevel: 'low' | 'medium' | 'high';
  
  // Display
  title: string;
  description: string;
  rationale: string[];
  
  // Status
  status: ActionStatus;
  statusUpdatedAt?: Date;
  
  // User
  userId?: string;  // If personalized
  
  // Validity
  expiresAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Action Schema
 */
const ActionSchema = new Schema<IAction>(
  {
    // Source
    decisionId: {
      type: String,
      required: true,
      index: true,
    },
    
    // Action
    actionType: {
      type: String,
      enum: ['copy_strategy', 'copy_actor', 'track_signal', 'set_alert', 'add_watchlist'],
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
    
    // Suggestions
    suggestedAssets: {
      type: [String],
      default: [],
    },
    suggestedAmountRange: {
      type: [Number],
    },
    
    // Confidence
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
    },
    
    // Display
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    rationale: {
      type: [String],
      default: [],
    },
    
    // Status
    status: {
      type: String,
      enum: ['suggested', 'accepted', 'dismissed', 'expired'],
      default: 'suggested',
      index: true,
    },
    statusUpdatedAt: {
      type: Date,
    },
    
    // User
    userId: {
      type: String,
      index: true,
    },
    
    // Validity
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'actions',
  }
);

// Indexes
ActionSchema.index({ status: 1, expiresAt: 1 });
ActionSchema.index({ userId: 1, status: 1, createdAt: -1 });
ActionSchema.index({ decisionId: 1 });

export const ActionModel = mongoose.model<IAction>('Action', ActionSchema);

/**
 * Action type display names
 */
export const ACTION_TYPE_NAMES: Record<ActionType, string> = {
  'copy_strategy': 'Copy Strategy',
  'copy_actor': 'Copy Actor',
  'track_signal': 'Track Signal',
  'set_alert': 'Set Alert',
  'add_watchlist': 'Add to Watchlist',
};

/**
 * Action validity (hours)
 */
export const ACTION_VALIDITY_HOURS: Record<ActionType, number> = {
  'copy_strategy': 48,
  'copy_actor': 48,
  'track_signal': 72,
  'set_alert': 72,
  'add_watchlist': 168,
};
