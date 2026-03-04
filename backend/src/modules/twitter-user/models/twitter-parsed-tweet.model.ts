/**
 * UserTwitterParsedTweet Model - Phase 1.4
 * 
 * Сохранение спарсенных твитов с привязкой к:
 * - ownerUserId (user scope)
 * - accountId (какой аккаунт использовался)
 * - sessionId (какая сессия)
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { OwnerType } from './_types.js';

export interface ITweetMetrics {
  likes: number;
  reposts: number;
  replies: number;
  views: number;
}

export interface ITweetAuthor {
  id: string;
  username: string;
  name?: string;
  avatar?: string;
  verified?: boolean;
  followers?: number;
}

export interface IUserTwitterParsedTweet extends Document {
  ownerType: OwnerType;
  ownerUserId?: string;
  
  // Phase 1.4: Track which account/session was used
  accountId?: string;
  sessionId?: string;
  taskId?: string;
  
  // Source tracking
  source?: 'SEARCH' | 'ACCOUNT';
  query?: string;         // for SEARCH (replaces keyword)
  targetUsername?: string; // for ACCOUNT
  
  // Tweet data
  tweetId: string;
  text: string;
  username: string;  // author username (backward compat)
  displayName?: string;
  
  // Metrics (flat for backward compat + nested for new)
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  
  // New: structured author
  author?: ITweetAuthor;
  
  // Media
  media?: string[];
  
  // Timestamps
  tweetedAt?: Date;
  parsedAt?: Date;
  
  // Legacy
  keyword?: string;
  url?: string;
  raw?: Record<string, unknown>;
  
  createdAt: Date;
  updatedAt: Date;
}

const TweetAuthorSchema = new Schema({
  id: String,
  username: String,
  name: String,
  avatar: String,
  verified: Boolean,
  followers: Number,
}, { _id: false });

const UserTwitterParsedTweetSchema = new Schema<IUserTwitterParsedTweet>(
  {
    ownerType: {
      type: String,
      required: true,
      enum: ['USER', 'SYSTEM'],
    },
    ownerUserId: String,
    
    // Phase 1.4
    accountId: String,
    sessionId: String,
    taskId: String,
    source: {
      type: String,
      enum: ['SEARCH', 'ACCOUNT'],
    },
    query: String,
    targetUsername: String,
    
    // Tweet
    tweetId: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      required: true,
    },
    displayName: String,
    
    // Metrics
    likes: { type: Number, default: 0 },
    reposts: { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    
    // Structured author
    author: TweetAuthorSchema,
    
    // Media
    media: [String],
    
    // Timestamps
    tweetedAt: Date,
    parsedAt: { type: Date, default: () => new Date() },
    
    // Legacy
    keyword: String,
    url: String,
    raw: Schema.Types.Mixed,
  },
  { timestamps: true }
);

// Indexes
// Unique: one tweet per user (dedupe)
UserTwitterParsedTweetSchema.index(
  { ownerUserId: 1, tweetId: 1 },
  { unique: true, sparse: true }
);

// Legacy indexes
UserTwitterParsedTweetSchema.index({ ownerType: 1, ownerUserId: 1, createdAt: -1 });
UserTwitterParsedTweetSchema.index({ ownerType: 1, ownerUserId: 1, keyword: 1, createdAt: -1 });

// Phase 1.4 indexes
UserTwitterParsedTweetSchema.index({ ownerUserId: 1, query: 1, parsedAt: -1 });
UserTwitterParsedTweetSchema.index({ ownerUserId: 1, source: 1, parsedAt: -1 });
UserTwitterParsedTweetSchema.index({ ownerUserId: 1, accountId: 1, parsedAt: -1 });

// Filtering
UserTwitterParsedTweetSchema.index({ tweetId: 1 });
UserTwitterParsedTweetSchema.index({ likes: -1 });
UserTwitterParsedTweetSchema.index({ reposts: -1 });

export const UserTwitterParsedTweetModel = mongoose.model<IUserTwitterParsedTweet>(
  'UserTwitterParsedTweet',
  UserTwitterParsedTweetSchema,
  'user_twitter_parsed_tweets'
);
