/**
 * Twitter Parser Module — Parse Target Model
 * 
 * User-defined parsing targets (keywords, accounts).
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY schema
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { TargetType } from './types.js';

export interface ITwitterParseTarget extends Document {
  ownerUserId: string;
  type: TargetType;
  query: string;
  enabled: boolean;
  priority: number;
  maxPostsPerRun: number;
  cooldownMin: number;
  
  // Filters for KEYWORD targets
  filters?: {
    minLikes?: number;
    minReposts?: number;
    timeRange?: '24h' | '48h' | '7d';
  };
  
  // Mode for ACCOUNT targets
  mode?: 'TWEETS' | 'REPLIES' | 'BOTH';
  
  lastPlannedAt?: Date;
  
  stats: {
    totalRuns: number;
    totalPostsFetched: number;
    lastRunAt?: Date;
    lastError?: string;
  };
  
  // Auto-Cooldown
  cooldownUntil?: Date;
  cooldownReason?: string;
  consecutiveEmptyCount?: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const TwitterParseTargetSchema = new Schema<ITwitterParseTarget>(
  {
    ownerUserId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['KEYWORD', 'ACCOUNT'],
      required: true,
    },
    query: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    enabled: { type: Boolean, default: true },
    priority: { type: Number, default: 3, min: 1, max: 5 },
    maxPostsPerRun: { type: Number, default: 50, min: 10, max: 200 },
    cooldownMin: { type: Number, default: 10, min: 5, max: 60 },
    
    filters: {
      minLikes: { type: Number, min: 0 },
      minReposts: { type: Number, min: 0 },
      timeRange: { type: String, enum: ['24h', '48h', '7d'] },
    },
    mode: {
      type: String,
      enum: ['TWEETS', 'REPLIES', 'BOTH'],
      default: 'TWEETS',
    },
    
    lastPlannedAt: Date,
    
    stats: {
      totalRuns: { type: Number, default: 0 },
      totalPostsFetched: { type: Number, default: 0 },
      lastRunAt: Date,
      lastError: String,
    },
    
    // Auto-Cooldown
    cooldownUntil: Date,
    cooldownReason: String,
    consecutiveEmptyCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'twitter_targets',
  }
);

// Indexes
TwitterParseTargetSchema.index({ ownerUserId: 1, enabled: 1 });
TwitterParseTargetSchema.index({ ownerUserId: 1, type: 1 });
TwitterParseTargetSchema.index({ ownerUserId: 1, lastPlannedAt: 1 });
TwitterParseTargetSchema.index({ ownerUserId: 1, priority: -1 });
TwitterParseTargetSchema.index(
  { ownerUserId: 1, type: 1, query: 1 },
  { unique: true }
);

export const TwitterParseTargetModel = mongoose.model<ITwitterParseTarget>(
  'TwitterParseTarget',
  TwitterParseTargetSchema
);
