/**
 * Twitter Parser Module — Parsed Tweet Model
 * 
 * Storage for parsed tweets with user isolation.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY schema
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { OwnerType } from './types.js';

export interface ITweetAuthor {
  id: string;
  username: string;
  name?: string;
  avatar?: string;
  verified?: boolean;
  followers?: number;
}

export interface ITweetMetrics {
  likes: number;
  reposts: number;
  replies: number;
  views: number;
}

export interface ITwitterParsedTweet extends Document {
  ownerType: OwnerType;
  ownerUserId?: string;
  
  // Tracking
  accountId?: string;
  sessionId?: string;
  taskId?: string;
  
  // Source
  source?: 'SEARCH' | 'ACCOUNT';
  query?: string;
  targetUsername?: string;
  
  // Tweet data
  tweetId: string;
  text: string;
  username: string;
  displayName?: string;
  
  // Metrics (flat for backward compat)
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  
  // Structured author
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

const TwitterParsedTweetSchema = new Schema<ITwitterParsedTweet>(
  {
    ownerType: {
      type: String,
      required: true,
      enum: ['USER', 'SYSTEM'],
    },
    ownerUserId: String,
    
    // Tracking
    accountId: String,
    sessionId: String,
    taskId: String,
    
    // Source
    source: { type: String, enum: ['SEARCH', 'ACCOUNT'] },
    query: String,
    targetUsername: String,
    
    // Tweet
    tweetId: { type: String, required: true },
    text: { type: String, required: true },
    username: { type: String, required: true },
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
  { 
    timestamps: true,
    collection: 'twitter_results',
  }
);

// Indexes
TwitterParsedTweetSchema.index(
  { ownerUserId: 1, tweetId: 1 },
  { unique: true, sparse: true }
);
TwitterParsedTweetSchema.index({ ownerType: 1, ownerUserId: 1, createdAt: -1 });
TwitterParsedTweetSchema.index({ ownerType: 1, ownerUserId: 1, keyword: 1, createdAt: -1 });
TwitterParsedTweetSchema.index({ ownerUserId: 1, query: 1, parsedAt: -1 });
TwitterParsedTweetSchema.index({ ownerUserId: 1, source: 1, parsedAt: -1 });
TwitterParsedTweetSchema.index({ ownerUserId: 1, accountId: 1, parsedAt: -1 });
TwitterParsedTweetSchema.index({ tweetId: 1 });
TwitterParsedTweetSchema.index({ likes: -1 });
TwitterParsedTweetSchema.index({ reposts: -1 });

export const TwitterParsedTweetModel = mongoose.model<ITwitterParsedTweet>(
  'TwitterParsedTweet',
  TwitterParsedTweetSchema
);
