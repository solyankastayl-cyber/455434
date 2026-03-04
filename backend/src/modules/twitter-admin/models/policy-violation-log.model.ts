/**
 * A.3.3 - Policy Violation Log Model
 * 
 * Records policy violations and actions taken
 */

import mongoose, { Schema, Document, Types } from 'mongoose';
import { PolicyAction } from './twitter-policy.model.js';

export type ViolationType = 
  | 'MAX_ACCOUNTS_EXCEEDED'
  | 'MAX_TASKS_EXCEEDED'
  | 'MAX_POSTS_EXCEEDED'
  | 'HIGH_ABORT_RATE'
  | 'REPEATED_COOLDOWNS';

export interface IPolicyViolationLog extends Document {
  _id: Types.ObjectId;
  userId: string;
  violationType: ViolationType;
  currentValue: number;
  limitValue: number;
  actionTaken: PolicyAction;
  cooldownUntil?: Date;
  metrics: {
    tasks1h?: number;
    posts24h?: number;
    abortRate24h?: number;
    activeAccounts?: number;
    staleSessions?: number;
  };
  notificationSent: boolean;
  adminNotified: boolean;
  createdAt: Date;
}

const PolicyViolationLogSchema = new Schema<IPolicyViolationLog>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    violationType: {
      type: String,
      required: true,
      enum: [
        'MAX_ACCOUNTS_EXCEEDED',
        'MAX_TASKS_EXCEEDED',
        'MAX_POSTS_EXCEEDED',
        'HIGH_ABORT_RATE',
        'REPEATED_COOLDOWNS',
      ],
    },
    currentValue: { type: Number, required: true },
    limitValue: { type: Number, required: true },
    actionTaken: {
      type: String,
      required: true,
      enum: ['WARN', 'COOLDOWN', 'DISABLE'],
    },
    cooldownUntil: Date,
    metrics: {
      tasks1h: Number,
      posts24h: Number,
      abortRate24h: Number,
      activeAccounts: Number,
      staleSessions: Number,
    },
    notificationSent: { type: Boolean, default: false },
    adminNotified: { type: Boolean, default: false },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: 'policy_violation_logs',
  }
);

// Index for recent violations per user
PolicyViolationLogSchema.index({ userId: 1, createdAt: -1 });

export const PolicyViolationLogModel = mongoose.model<IPolicyViolationLog>(
  'PolicyViolationLog',
  PolicyViolationLogSchema
);
