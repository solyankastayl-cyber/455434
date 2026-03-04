/**
 * UserTwitterParseTarget - что именно парсить
 * 
 * Типы:
 * - KEYWORD: поисковый запрос
 * - ACCOUNT: timeline пользователя
 * 
 * User-scoped: каждый юзер видит только свои targets
 */

import mongoose, { Schema, Document } from 'mongoose';

export enum TwitterParseTargetType {
  KEYWORD = 'KEYWORD',
  ACCOUNT = 'ACCOUNT',
}

export interface IUserTwitterParseTarget extends Document {
  /** ID владельца */
  ownerUserId: string;
  
  /** Тип таргета */
  type: TwitterParseTargetType;
  
  /** Поисковый запрос или username (без @) */
  query: string;
  
  /** Включён ли таргет */
  enabled: boolean;
  
  /** Приоритет (1-5, выше = важнее) */
  priority: number;
  
  /** Макс. постов за один run */
  maxPostsPerRun: number;
  
  /** Cooldown между запусками (минуты) */
  cooldownMin: number;
  
  /** Фильтры для KEYWORD targets */
  filters?: {
    minLikes?: number;
    minReposts?: number;
    timeRange?: '24h' | '48h' | '7d';
  };
  
  /** Режим для ACCOUNT targets */
  mode?: 'TWEETS' | 'REPLIES' | 'BOTH';
  
  /** Когда последний раз планировался */
  lastPlannedAt?: Date;
  
  /** Статистика */
  stats: {
    totalRuns: number;
    totalPostsFetched: number;
    lastRunAt?: Date;
    lastError?: string;
  };
  
  // Phase 4.2: Auto-Cooldown
  cooldownUntil?: Date;
  cooldownReason?: string;
  /** Consecutive fetched=0 count */
  consecutiveEmptyCount?: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const UserTwitterParseTargetSchema = new Schema<IUserTwitterParseTarget>(
  {
    ownerUserId: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(TwitterParseTargetType),
      required: true,
    },
    query: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    priority: {
      type: Number,
      default: 3,
      min: 1,
      max: 5,
    },
    maxPostsPerRun: {
      type: Number,
      default: 50,
      min: 10,
      max: 200,
    },
    cooldownMin: {
      type: Number,
      default: 10,
      min: 5,
      max: 60,
    },
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
    lastPlannedAt: {
      type: Date,
    },
    stats: {
      totalRuns: { type: Number, default: 0 },
      totalPostsFetched: { type: Number, default: 0 },
      lastRunAt: Date,
      lastError: String,
    },
    
    // Phase 4.2: Auto-Cooldown
    cooldownUntil: Date,
    cooldownReason: String,
    consecutiveEmptyCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'user_twitter_parse_targets',
  }
);

// Compound indexes for efficient queries
UserTwitterParseTargetSchema.index({ ownerUserId: 1, enabled: 1 });
UserTwitterParseTargetSchema.index({ ownerUserId: 1, type: 1 });
UserTwitterParseTargetSchema.index({ ownerUserId: 1, lastPlannedAt: 1 });
UserTwitterParseTargetSchema.index({ ownerUserId: 1, priority: -1 });

// Unique constraint: user can't have duplicate query+type
UserTwitterParseTargetSchema.index(
  { ownerUserId: 1, type: 1, query: 1 },
  { unique: true }
);

export const UserTwitterParseTargetModel = mongoose.model<IUserTwitterParseTarget>(
  'UserTwitterParseTarget',
  UserTwitterParseTargetSchema
);
