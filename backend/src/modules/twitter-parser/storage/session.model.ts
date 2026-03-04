/**
 * Twitter Parser Module — Session Model
 * 
 * Stores encrypted Twitter cookies with session versioning.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY schema
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { OwnerType, SessionStatus } from './types.js';

export interface ITwitterSession extends Document {
  ownerType: OwnerType;
  ownerUserId?: string;
  accountId: mongoose.Types.ObjectId;
  
  // Session Versioning
  version: number;
  isActive: boolean;
  supersededAt?: Date;
  
  // Status
  status: SessionStatus;
  riskScore: number;
  lifetimeDaysEstimate: number;
  lastOkAt?: Date;
  lastSyncAt?: Date;
  lastWarmAt?: Date;
  staleReason?: string;
  
  // Runtime telemetry
  avgLatencyMs?: number;
  lastAbortAt?: Date;
  successRate?: number;
  
  // Encrypted cookies (AES-256-GCM)
  cookiesEnc: string;
  cookiesIv: string;
  cookiesTag: string;
  
  // Metadata
  userAgent?: string;
  ip?: string;
  consentAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const TwitterSessionSchema = new Schema<ITwitterSession>(
  {
    ownerType: {
      type: String,
      required: true,
      enum: ['USER', 'SYSTEM'],
    },
    ownerUserId: String,
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'TwitterAccount',
      required: true,
      index: true,
    },
    
    // Session Versioning
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    supersededAt: Date,
    
    // Status
    status: {
      type: String,
      required: true,
      enum: ['OK', 'STALE', 'EXPIRED', 'INVALID', 'ERROR'],
    },
    riskScore: {
      type: Number,
      required: true,
      default: 0,
      set: (v: any) => {
        const num = Number(v);
        return Number.isFinite(num) ? Math.max(0, Math.min(num, 100)) : 0;
      },
    },
    lifetimeDaysEstimate: {
      type: Number,
      required: true,
      default: 14,
    },
    lastOkAt: Date,
    lastSyncAt: Date,
    lastWarmAt: Date,
    staleReason: String,
    
    // Runtime telemetry
    avgLatencyMs: Number,
    lastAbortAt: Date,
    successRate: Number,
    
    // Encrypted fields
    cookiesEnc: { type: String, required: true },
    cookiesIv: { type: String, required: true },
    cookiesTag: { type: String, required: true },
    
    // Metadata
    userAgent: String,
    ip: String,
    consentAt: Date,
  },
  { 
    timestamps: true,
    collection: 'twitter_sessions',
  }
);

// Indexes
TwitterSessionSchema.index({ ownerType: 1, ownerUserId: 1 });
TwitterSessionSchema.index(
  { accountId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);
TwitterSessionSchema.index({ status: 1, updatedAt: -1 });
TwitterSessionSchema.index({ ownerUserId: 1, accountId: 1, isActive: 1 });

export const TwitterSessionModel = mongoose.model<ITwitterSession>(
  'TwitterSession',
  TwitterSessionSchema
);
