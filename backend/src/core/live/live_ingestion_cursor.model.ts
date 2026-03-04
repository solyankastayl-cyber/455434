/**
 * Live Ingestion Cursor Model
 * 
 * Tracks block processing progress for each token in the live ingestion pipeline.
 * One cursor per (chainId, tokenAddress) pair.
 */
import mongoose from 'mongoose';

export interface ILiveIngestionCursor {
  chainId: number;
  tokenAddress: string;
  lastProcessedBlock: number;
  targetHeadBlock: number;
  rangeHint: number;              // Adaptive range size for getLogs
  providerUsed: 'infura' | 'ankr';
  mode: 'bootstrap' | 'tail';
  createdAt: Date;
  updatedAt: Date;
}

const LiveIngestionCursorSchema = new mongoose.Schema<ILiveIngestionCursor>({
  chainId: {
    type: Number,
    required: true,
    default: 1, // Ethereum mainnet
  },
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  lastProcessedBlock: {
    type: Number,
    required: true,
    default: 0,
  },
  targetHeadBlock: {
    type: Number,
    required: true,
    default: 0,
  },
  rangeHint: {
    type: Number,
    required: true,
    default: 1500, // Initial range
  },
  providerUsed: {
    type: String,
    enum: ['infura', 'ankr'],
    default: 'infura',
  },
  mode: {
    type: String,
    enum: ['bootstrap', 'tail'],
    default: 'bootstrap',
  },
}, {
  collection: 'live_ingestion_cursors',
  timestamps: true,
});

// Unique index per chain + token
LiveIngestionCursorSchema.index({ chainId: 1, tokenAddress: 1 }, { unique: true });

// Query index
LiveIngestionCursorSchema.index({ mode: 1, updatedAt: -1 });

export const LiveIngestionCursorModel = mongoose.model<ILiveIngestionCursor>(
  'LiveIngestionCursor',
  LiveIngestionCursorSchema
);
