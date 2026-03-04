/**
 * A.3.3 - Twitter Policy Model
 * 
 * Policy-driven control for fair-use and platform protection:
 * - GLOBAL policy (default for all users)
 * - USER-specific overrides
 */

import mongoose, { Schema, Document, Types } from 'mongoose';

export type PolicyScope = 'GLOBAL' | 'USER';
export type PolicyAction = 'WARN' | 'COOLDOWN' | 'DISABLE';

export interface IPolicyLimits {
  maxAccounts?: number;
  maxTasksPerHour?: number;
  maxPostsPerDay?: number;
  maxAbortRatePct?: number; // percentage
}

export interface IPolicyActions {
  onLimitExceeded: PolicyAction;
  cooldownMinutes?: number;
}

export interface ITwitterPolicy extends Document {
  _id: Types.ObjectId;
  scope: PolicyScope;
  userId?: string; // Only for USER scope
  limits: IPolicyLimits;
  actions: IPolicyActions;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TwitterPolicySchema = new Schema<ITwitterPolicy>(
  {
    scope: {
      type: String,
      required: true,
      enum: ['GLOBAL', 'USER'],
      index: true,
    },
    userId: {
      type: String,
      sparse: true,
      index: true,
    },
    limits: {
      maxAccounts: { type: Number, default: 3 },
      maxTasksPerHour: { type: Number, default: 20 },
      maxPostsPerDay: { type: Number, default: 1000 },
      maxAbortRatePct: { type: Number, default: 30 },
    },
    actions: {
      onLimitExceeded: { 
        type: String, 
        enum: ['WARN', 'COOLDOWN', 'DISABLE'],
        default: 'COOLDOWN',
      },
      cooldownMinutes: { type: Number, default: 30 },
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    collection: 'twitter_policies',
    timestamps: true,
  }
);

// Ensure only one GLOBAL policy
TwitterPolicySchema.index(
  { scope: 1, userId: 1 },
  { unique: true, partialFilterExpression: { scope: 'USER' } }
);

export const TwitterPolicyModel = mongoose.model<ITwitterPolicy>(
  'TwitterPolicy',
  TwitterPolicySchema
);

// Default global policy values
export const DEFAULT_GLOBAL_POLICY: IPolicyLimits & { actions: IPolicyActions } = {
  maxAccounts: 3,
  maxTasksPerHour: 20,
  maxPostsPerDay: 1000,
  maxAbortRatePct: 30,
  actions: {
    onLimitExceeded: 'COOLDOWN',
    cooldownMinutes: 30,
  },
};
