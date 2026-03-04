/**
 * Twitter Parser Module — Task Model
 * 
 * Persistent task queue with atomic claim.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY schema
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { OwnerType, TaskStatus, TaskType, TaskPriority } from './types.js';

export interface ITwitterTask extends Document {
  // Owner fields
  ownerType: OwnerType;
  ownerUserId?: string;
  scope: 'USER' | 'SYSTEM';
  
  // Task info
  status: TaskStatus;
  type: TaskType;
  payload: Record<string, any>;
  
  // Retry
  attempts: number;
  maxAttempts: number;
  retryCount: number;
  lastErrorCode?: string;
  nextRetryAt?: Date;
  
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
  
  createdAt: Date;
  updatedAt: Date;
}

const TwitterTaskSchema = new Schema<ITwitterTask>(
  {
    // Owner fields
    ownerType: {
      type: String,
      enum: ['USER', 'SYSTEM'],
      default: 'SYSTEM',
      index: true,
    },
    ownerUserId: { type: String, index: true },
    scope: {
      type: String,
      enum: ['USER', 'SYSTEM'],
      default: 'SYSTEM',
      index: true,
    },
    
    // Task info
    status: { 
      type: String, 
      enum: ['PENDING', 'RUNNING', 'DONE', 'FAILED', 'COOLDOWN'], 
      default: 'PENDING',
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
    retryCount: { type: Number, default: 0 },
    lastErrorCode: String,
    nextRetryAt: Date,
    
    // Locking
    lockedAt: Date,
    lockedBy: String,
    
    // Execution binding
    accountId: String,
    slotId: String,
    instanceId: String,
    
    // Priority
    priority: { 
      type: String, 
      enum: ['LOW', 'NORMAL', 'HIGH'], 
      default: 'NORMAL',
    },
    priorityValue: { type: Number, default: 10 },
    
    // Timing
    cooldownUntil: Date,
    startedAt: Date,
    completedAt: Date,
    
    // Results
    result: Schema.Types.Mixed,
    lastError: String,
  },
  { 
    timestamps: true, 
    collection: 'twitter_tasks',
  }
);

// Indexes
TwitterTaskSchema.index(
  { status: 1, priorityValue: -1, createdAt: 1 },
  { name: 'claim_query_idx' }
);
TwitterTaskSchema.index(
  { status: 1, lockedAt: 1 },
  { name: 'locked_recovery_idx' }
);
TwitterTaskSchema.index(
  { cooldownUntil: 1 },
  { name: 'cooldown_idx' }
);
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

export const TwitterTaskModel = mongoose.model<ITwitterTask>(
  'TwitterTask',
  TwitterTaskSchema
);
