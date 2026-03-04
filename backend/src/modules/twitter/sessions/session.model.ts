// TwitterSession Model - MULTI Architecture + P1 Risk Engine + Scope Support
import mongoose, { Schema, Document, Types } from 'mongoose';
import { ExecutionScope } from '../core/execution-scope.js';

export type SessionStatus = 'OK' | 'STALE' | 'INVALID' | 'EXPIRED';

export interface SessionMetrics {
  parserErrors24h: number;
  warmthFailures24h: number;
  rateLimitHits24h: number;
  successfulRequests24h: number;
}

export interface ITwitterSession extends Document {
  accountId?: Types.ObjectId;
  sessionId: string;
  encryptedCookies: string;
  userAgent: string;
  cookiesMeta?: {
    count: number;
    domains: string[];
    hasAuthToken: boolean;
    hasCt0?: boolean;
  };
  status: SessionStatus;
  
  // Scope: USER vs SYSTEM
  scope: ExecutionScope;
  
  // P1: Risk Engine fields
  riskScore: number;              // 0-100
  expectedLifetimeDays?: number;  // Predicted remaining days
  
  // P1: Timing fields
  lastSyncedAt?: Date;
  lastUsedAt?: Date;
  lastCheckedAt?: Date;           // Last health check
  lastWarmthAt?: Date;            // Last warmth ping
  lastStatusChangeAt?: Date;      // When status last changed
  
  // P1: Metrics for risk calculation
  metrics: SessionMetrics;
  
  lastError?: {
    code: string;
    message: string;
    at: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const TwitterSessionSchema = new Schema<ITwitterSession>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'TwitterAccount' },
    sessionId: { type: String, required: true, unique: true },
    encryptedCookies: { type: String, required: true },
    userAgent: { type: String, required: true },
    cookiesMeta: {
      count: { type: Number },
      domains: [{ type: String }],
      hasAuthToken: { type: Boolean },
      hasCt0: { type: Boolean },
    },
    status: { type: String, enum: ['OK', 'STALE', 'INVALID', 'EXPIRED'], default: 'STALE' },
    
    // Scope field
    scope: { 
      type: String, 
      enum: Object.values(ExecutionScope), 
      default: ExecutionScope.USER,
      index: true,
    },
    
    // P1: Risk Engine fields
    riskScore: { type: Number, default: 50, min: 0, max: 100 },
    expectedLifetimeDays: { type: Number },
    
    // P1: Timing fields
    lastSyncedAt: { type: Date },
    lastUsedAt: { type: Date },
    lastCheckedAt: { type: Date },
    lastWarmthAt: { type: Date },
    lastStatusChangeAt: { type: Date },
    
    // P1: Metrics
    metrics: {
      parserErrors24h: { type: Number, default: 0 },
      warmthFailures24h: { type: Number, default: 0 },
      rateLimitHits24h: { type: Number, default: 0 },
      successfulRequests24h: { type: Number, default: 0 },
    },
    
    lastError: {
      code: { type: String },
      message: { type: String },
      at: { type: Date },
    },
  },
  { timestamps: true, collection: 'twitter_sessions' }
);

TwitterSessionSchema.index({ status: 1 });
TwitterSessionSchema.index({ lastSyncedAt: -1 });
TwitterSessionSchema.index({ accountId: 1 });
TwitterSessionSchema.index({ scope: 1, status: 1 });

export const TwitterSessionModel = mongoose.model<ITwitterSession>('TwitterSession', TwitterSessionSchema);

export type TwitterSession = ITwitterSession;
