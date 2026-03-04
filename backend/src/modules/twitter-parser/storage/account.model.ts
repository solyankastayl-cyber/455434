/**
 * Twitter Parser Module — Account Model
 * 
 * Twitter account metadata with cooldown support.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY schema
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { OwnerType } from './types.js';

export interface ITwitterAccount extends Document {
  ownerType: OwnerType;
  ownerUserId?: string;
  username: string;
  displayName?: string;
  verified?: boolean;
  enabled: boolean;
  
  // Session Selection
  isPreferred?: boolean;
  priority?: number;
  
  preferredSlotId?: string;
  requestsInWindow: number;
  windowStartedAt?: Date;
  
  // Auto-Cooldown
  cooldownUntil?: Date;
  cooldownReason?: string;
  cooldownCount: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const TwitterAccountSchema = new Schema<ITwitterAccount>(
  {
    ownerType: {
      type: String,
      required: true,
      enum: ['USER', 'SYSTEM'],
    },
    ownerUserId: String,
    username: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    displayName: String,
    verified: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    
    // Session Selection
    isPreferred: { type: Boolean, default: false },
    priority: { type: Number, default: 0 },
    
    preferredSlotId: String,
    requestsInWindow: { type: Number, default: 0 },
    windowStartedAt: Date,
    
    // Auto-Cooldown
    cooldownUntil: Date,
    cooldownReason: String,
    cooldownCount: { type: Number, default: 0 },
  },
  { 
    timestamps: true,
    collection: 'twitter_accounts',
  }
);

// Indexes
TwitterAccountSchema.index({ ownerType: 1, ownerUserId: 1 });
TwitterAccountSchema.index(
  { ownerType: 1, ownerUserId: 1, username: 1 },
  { unique: true }
);

export const TwitterAccountModel = mongoose.model<ITwitterAccount>(
  'TwitterAccount',
  TwitterAccountSchema
);
