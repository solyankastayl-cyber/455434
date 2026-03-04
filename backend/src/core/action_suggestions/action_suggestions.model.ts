/**
 * Action Suggestions Model (Phase 13.2)
 * 
 * Generated action suggestions based on signals/decisions.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type SuggestionReason = 
  | 'wash_detected'
  | 'strategy_shift'
  | 'influence_jump'
  | 'intensity_spike'
  | 'risk_spike'
  | 'accumulation_pattern'
  | 'distribution_pattern'
  | 'whale_activity'
  | 'high_score';

export interface IActionSuggestion extends Document {
  _id: Types.ObjectId;
  
  // Target user
  userId: string;
  
  // Source signal/event
  sourceType: string;
  sourceId: string;
  
  // What triggered this suggestion
  reason: SuggestionReason;
  reasonDetails: string;
  
  // Suggested actions
  suggestedActions: {
    type: string;
    priority: number;
    params: Record<string, any>;
    explanation: string;
  }[];
  
  // Context
  targetType: 'actor' | 'token' | 'entity' | 'strategy';
  targetId: string;
  targetLabel?: string;
  
  // Scores
  confidenceScore: number;    // How confident we are in this suggestion
  relevanceScore: number;     // How relevant to user's profile
  urgencyScore: number;       // How time-sensitive
  
  // State
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  userFeedback?: string;
  
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

const SuggestedActionSchema = new Schema(
  {
    type: { type: String, required: true },
    priority: { type: Number, default: 3 },
    params: { type: Schema.Types.Mixed, default: {} },
    explanation: { type: String, required: true },
  },
  { _id: false }
);

const ActionSuggestionSchema = new Schema<IActionSuggestion>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    
    sourceType: { type: String, required: true },
    sourceId: { type: String, required: true, index: true },
    
    reason: {
      type: String,
      enum: ['wash_detected', 'strategy_shift', 'influence_jump', 'intensity_spike', 'risk_spike', 'accumulation_pattern', 'distribution_pattern', 'whale_activity', 'high_score'],
      required: true,
      index: true,
    },
    reasonDetails: { type: String, required: true },
    
    suggestedActions: {
      type: [SuggestedActionSchema],
      required: true,
    },
    
    targetType: {
      type: String,
      enum: ['actor', 'token', 'entity', 'strategy'],
      required: true,
    },
    targetId: { type: String, required: true, index: true },
    targetLabel: String,
    
    confidenceScore: { type: Number, default: 0.5 },
    relevanceScore: { type: Number, default: 0.5 },
    urgencyScore: { type: Number, default: 0.5 },
    
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'expired'],
      default: 'pending',
      index: true,
    },
    userFeedback: String,
    
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'action_suggestions',
  }
);

// TTL index
ActionSuggestionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ActionSuggestionModel = mongoose.model<IActionSuggestion>(
  'ActionSuggestion',
  ActionSuggestionSchema
);

/**
 * Suggestion rules based on signal type
 */
export const SUGGESTION_RULES: Record<string, {
  reason: SuggestionReason;
  actions: { type: string; priority: number; explanation: string }[];
}> = {
  wash_detected: {
    reason: 'wash_detected',
    actions: [
      { type: 'notify', priority: 1, explanation: 'Alert about potential wash trading' },
      { type: 'create_alert_rule', priority: 2, explanation: 'Create rule to monitor this actor' },
    ],
  },
  strategy_shift: {
    reason: 'strategy_shift',
    actions: [
      { type: 'follow', priority: 2, explanation: 'Follow actor to track behavior changes' },
      { type: 'add_to_watchlist', priority: 2, explanation: 'Add to watchlist for monitoring' },
      { type: 'simulate_copy', priority: 3, explanation: 'Simulate paper copy to test new strategy' },
    ],
  },
  influence_jump: {
    reason: 'influence_jump',
    actions: [
      { type: 'follow', priority: 2, explanation: 'Follow newly influential actor' },
      { type: 'add_to_watchlist', priority: 2, explanation: 'Add to watchlist' },
      { type: 'notify', priority: 3, explanation: 'Set up notifications' },
    ],
  },
  intensity_spike: {
    reason: 'intensity_spike',
    actions: [
      { type: 'paper_entry', priority: 2, explanation: 'Consider paper entry on momentum' },
      { type: 'add_to_watchlist', priority: 3, explanation: 'Monitor for continuation' },
    ],
  },
  risk_spike: {
    reason: 'risk_spike',
    actions: [
      { type: 'notify', priority: 1, explanation: 'Urgent: Risk level increased' },
      { type: 'paper_exit', priority: 2, explanation: 'Consider reducing exposure' },
    ],
  },
};
