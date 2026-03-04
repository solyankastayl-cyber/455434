// P2: Twitter Task Model - Persistent Queue
// Mongo-based task queue with atomic claim

import mongoose, { Schema, Document, Types } from 'mongoose';
import { ExecutionScope, OwnerType } from '../../core/execution-scope.js';

export enum TaskStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

export type TaskType = 'SEARCH' | 'ACCOUNT_TWEETS' | 'ACCOUNT_FOLLOWERS' | 'ACCOUNT_SUMMARY';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface ITwitterTask extends Document {
  // P4.1: Owner fields for user isolation
  ownerType: OwnerType;
  ownerUserId?: string;
  
  // Scope for execution context
  scope: ExecutionScope;
  
  status: TaskStatus;
  type: TaskType;
  payload: Record<string, any>;
  
  // Retry
  attempts: number;
  maxAttempts: number;
  
  // Locking
  lockedAt?: Date;
  lockedBy?: string;
  
  // Execution binding
  accountId?: string;
  slotId?: string;
  instanceId?: string;
  
  // Priority
  priority: TaskPriority;
  priorityValue: number;
  
  // Timing
  cooldownUntil?: Date;
  startedAt?: Date;
  completedAt?: Date;
  
  // Results
  result?: any;
  lastError?: string;
  
  // Phase 4.1: Retry tracking
  retryCount: number;
  lastErrorCode?: string;
  nextRetryAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const TwitterTaskSchema = new Schema<ITwitterTask>(
  {
    // P4.1: Owner fields
    ownerType: {
      type: String,
      enum: Object.values(OwnerType),
      default: OwnerType.SYSTEM,
      index: true,
    },
    ownerUserId: {
      type: String,
      index: true,
    },
    
    // Scope for execution context
    scope: {
      type: String,
      enum: Object.values(ExecutionScope),
      default: ExecutionScope.SYSTEM,
      index: true,
    },
    
    status: { 
      type: String, 
      enum: Object.values(TaskStatus), 
      default: TaskStatus.PENDING,
      index: true,
    },
    type: { 
      type: String, 
      enum: ['SEARCH', 'ACCOUNT_TWEETS', 'ACCOUNT_FOLLOWERS', 'ACCOUNT_SUMMARY'],
      required: true,
    },
    payload: { type: Schema.Types.Mixed, required: true },
    
    // Retry
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    
    // Locking for atomic claim
    lockedAt: { type: Date },
    lockedBy: { type: String },
    
    // Execution binding
    accountId: { type: String },
    slotId: { type: String },
    instanceId: { type: String },
    
    // Priority
    priority: { 
      type: String, 
      enum: ['LOW', 'NORMAL', 'HIGH'], 
      default: 'NORMAL',
    },
    priorityValue: { type: Number, default: 10 },
    
    // Timing
    cooldownUntil: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    
    // Results
    result: { type: Schema.Types.Mixed },
    lastError: { type: String },
    
    // Phase 4.1: Retry tracking
    retryCount: { type: Number, default: 0 },
    lastErrorCode: { type: String },
    nextRetryAt: { type: Date },
  },
  { 
    timestamps: true, 
    collection: 'twitter_tasks',
  }
);

// Compound index for efficient claim query
TwitterTaskSchema.index(
  { status: 1, priorityValue: -1, createdAt: 1 },
  { name: 'claim_query_idx' }
);

// Index for locked task recovery
TwitterTaskSchema.index(
  { status: 1, lockedAt: 1 },
  { name: 'locked_recovery_idx' }
);

// Index for cooldown check
TwitterTaskSchema.index(
  { cooldownUntil: 1 },
  { name: 'cooldown_idx' }
);

// P4.1: Owner isolation indexes
TwitterTaskSchema.index(
  { ownerType: 1, ownerUserId: 1, status: 1, priorityValue: -1 },
  { name: 'owner_claim_idx' }
);

// Priority value mapping
export const PRIORITY_VALUES: Record<TaskPriority, number> = {
  LOW: 0,
  NORMAL: 10,
  HIGH: 20,
};

export const TwitterTaskModel = mongoose.model<ITwitterTask>('TwitterTask', TwitterTaskSchema);
