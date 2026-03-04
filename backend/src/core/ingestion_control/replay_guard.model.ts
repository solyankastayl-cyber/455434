/**
 * Ingestion Replay Guard (P0.1)
 * 
 * Ensures idempotent ingestion - no duplicate processing of block ranges.
 * Tracks what's been processed, in-progress, and failed.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type ReplayStatus = 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'PARTIAL';

export interface IReplayGuardEntry {
  chain: string;
  fromBlock: number;
  toBlock: number;
  status: ReplayStatus;
  
  // Progress tracking
  eventsFound: number;
  eventsIngested: number;
  
  // Timing
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  
  // Error info (if failed)
  error?: string;
  retryCount: number;
  
  // Metadata
  workerId?: string;  // For distributed processing
}

export interface IReplayGuardDocument extends IReplayGuardEntry, Document {}

// ============================================
// Schema
// ============================================

const ReplayGuardSchema = new Schema<IReplayGuardDocument>({
  chain: { type: String, required: true, uppercase: true },
  fromBlock: { type: Number, required: true },
  toBlock: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['IN_PROGRESS', 'DONE', 'FAILED', 'PARTIAL'],
    default: 'IN_PROGRESS'
  },
  
  eventsFound: { type: Number, default: 0 },
  eventsIngested: { type: Number, default: 0 },
  
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date },
  durationMs: { type: Number },
  
  error: { type: String },
  retryCount: { type: Number, default: 0 },
  
  workerId: { type: String }
});

// Unique constraint - one entry per chain+range
ReplayGuardSchema.index({ chain: 1, fromBlock: 1, toBlock: 1 }, { unique: true });

// Query indexes
ReplayGuardSchema.index({ chain: 1, status: 1 });
ReplayGuardSchema.index({ status: 1, startedAt: 1 });

export const ReplayGuardModel = mongoose.model<IReplayGuardDocument>(
  'ingestion_replay_guard',
  ReplayGuardSchema
);

// ============================================
// Failed Block Ranges
// ============================================

export interface IFailedRangeEntry {
  chain: string;
  fromBlock: number;
  toBlock: number;
  reason: string;
  retryCount: number;
  lastRetryAt?: Date;
  nextRetryAt?: Date;
  resolved: boolean;
}

export interface IFailedRangeDocument extends IFailedRangeEntry, Document {}

const FailedRangeSchema = new Schema<IFailedRangeDocument>({
  chain: { type: String, required: true, uppercase: true },
  fromBlock: { type: Number, required: true },
  toBlock: { type: Number, required: true },
  reason: { type: String, required: true },
  retryCount: { type: Number, default: 0 },
  lastRetryAt: { type: Date },
  nextRetryAt: { type: Date },
  resolved: { type: Boolean, default: false }
});

FailedRangeSchema.index({ chain: 1, resolved: 1 });
FailedRangeSchema.index({ nextRetryAt: 1 });

export const FailedRangeModel = mongoose.model<IFailedRangeDocument>(
  'ingestion_failed_ranges',
  FailedRangeSchema
);
