/**
 * User Signal Outcomes Model (Phase 12B.3)
 * 
 * Tracks user decisions on signals and their outcomes.
 * Used to learn user bias and calculate personalized scores.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type SignalDecision = 'follow' | 'ignore' | 'dismiss' | 'watchlist';
export type OutcomeResult = 'positive' | 'negative' | 'neutral' | 'pending';

export interface IUserSignalOutcome extends Document {
  _id: Types.ObjectId;
  
  userId: string;
  signalId: string;
  
  // User's decision
  decision: SignalDecision;
  decisionAt: Date;
  
  // Context at decision time
  signalType: string;
  signalSeverity: number;
  actorAddress: string;
  strategyType?: string;
  
  // System state at decision
  confidenceAtTime: number;
  globalScoreAtTime: number;
  personalizedScoreAtTime?: number;
  
  // Outcome tracking
  outcome: OutcomeResult;
  virtualPnL?: number;           // Simulated PnL if followed
  actualPnL?: number;            // Real PnL if user has connected wallet
  outcomeEvaluatedAt?: Date;
  
  // For learning
  wasCorrectDecision?: boolean;  // Did outcome match decision?
  learningWeight: number;        // How much to weight in learning
  
  createdAt: Date;
  updatedAt: Date;
}

const UserSignalOutcomeSchema = new Schema<IUserSignalOutcome>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    signalId: {
      type: String,
      required: true,
      index: true,
    },
    
    decision: {
      type: String,
      enum: ['follow', 'ignore', 'dismiss', 'watchlist'],
      required: true,
    },
    decisionAt: {
      type: Date,
      required: true,
    },
    
    signalType: {
      type: String,
      required: true,
      index: true,
    },
    signalSeverity: {
      type: Number,
      required: true,
    },
    actorAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    strategyType: String,
    
    confidenceAtTime: {
      type: Number,
      required: true,
    },
    globalScoreAtTime: {
      type: Number,
      required: true,
    },
    personalizedScoreAtTime: Number,
    
    outcome: {
      type: String,
      enum: ['positive', 'negative', 'neutral', 'pending'],
      default: 'pending',
    },
    virtualPnL: Number,
    actualPnL: Number,
    outcomeEvaluatedAt: Date,
    
    wasCorrectDecision: Boolean,
    learningWeight: {
      type: Number,
      default: 1.0,
    },
  },
  {
    timestamps: true,
    collection: 'user_signal_outcomes',
  }
);

// Compound indexes
UserSignalOutcomeSchema.index({ userId: 1, signalId: 1 }, { unique: true });
UserSignalOutcomeSchema.index({ userId: 1, decision: 1, createdAt: -1 });
UserSignalOutcomeSchema.index({ userId: 1, outcome: 1 });
UserSignalOutcomeSchema.index({ outcome: 1, outcomeEvaluatedAt: 1 });

export const UserSignalOutcomeModel = mongoose.model<IUserSignalOutcome>(
  'UserSignalOutcome',
  UserSignalOutcomeSchema
);
