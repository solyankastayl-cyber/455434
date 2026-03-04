/**
 * UserTwitterParseTask Model - Phase 1.4
 * 
 * Tracking parse tasks lifecycle:
 * PENDING → RUNNING → DONE / PARTIAL / FAILED
 */

import mongoose, { Schema, Document } from 'mongoose';

export type ParseTaskType = 'SEARCH' | 'ACCOUNT';
export type ParseTaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'PARTIAL' | 'FAILED';

export interface IUserTwitterParseTask extends Document {
  // Ownership
  ownerUserId: string;
  accountId: string;
  sessionId: string;
  
  // Task config
  type: ParseTaskType;
  query?: string;           // for SEARCH
  targetUsername?: string;  // for ACCOUNT
  limit: number;
  filters?: {
    minLikes?: number;
    minReposts?: number;
    timeRange?: string;
  };
  
  // Status
  status: ParseTaskStatus;
  
  // Results
  fetched: number;
  durationMs?: number;
  
  // Engine summary
  engineSummary?: {
    riskMax: number;
    aborted: boolean;
    abortReason?: string;
    profile: string;
    profileChanges: number;
    scrollCount: number;
  };
  
  // Error tracking
  error?: string;
  
  // Timestamps
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserTwitterParseTaskSchema = new Schema<IUserTwitterParseTask>(
  {
    ownerUserId: {
      type: String,
      required: true,
      index: true,
    },
    accountId: {
      type: String,
      required: true,
    },
    sessionId: {
      type: String,
      required: true,
    },
    
    type: {
      type: String,
      required: true,
      enum: ['SEARCH', 'ACCOUNT'],
    },
    query: String,
    targetUsername: String,
    limit: {
      type: Number,
      required: true,
      default: 50,
    },
    filters: {
      type: Schema.Types.Mixed,
    },
    
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'RUNNING', 'DONE', 'PARTIAL', 'FAILED'],
      default: 'PENDING',
    },
    
    fetched: {
      type: Number,
      default: 0,
    },
    durationMs: Number,
    
    engineSummary: {
      type: Schema.Types.Mixed,
    },
    
    error: String,
    
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

// Indexes
UserTwitterParseTaskSchema.index({ ownerUserId: 1, status: 1, createdAt: -1 });
UserTwitterParseTaskSchema.index({ ownerUserId: 1, type: 1, createdAt: -1 });
UserTwitterParseTaskSchema.index({ status: 1, createdAt: 1 }); // For queue processing

export const UserTwitterParseTaskModel = mongoose.model<IUserTwitterParseTask>(
  'UserTwitterParseTask',
  UserTwitterParseTaskSchema,
  'user_twitter_parse_tasks'
);
