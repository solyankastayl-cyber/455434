/**
 * ETAP 6.1 — Ingest Cursor Model
 * 
 * Tracks block processing progress for incremental ingestion.
 * One cursor per (chain, feed, window) combination.
 */
import mongoose from 'mongoose';

export interface IIngestCursor {
  chain: string;
  feed: string;                     // 'erc20_transfers'
  window: string;                   // '24h' | '7d' | '30d'
  
  lastBlockNumber: number;
  lastBlockTime: Date;
  
  updatedAt: Date;
}

const IngestCursorSchema = new mongoose.Schema<IIngestCursor>({
  chain: {
    type: String,
    required: true,
    default: 'ethereum',
  },
  feed: {
    type: String,
    required: true,
    default: 'erc20_transfers',
  },
  window: {
    type: String,
    required: true,
    enum: ['24h', '7d', '30d'],
  },
  lastBlockNumber: {
    type: Number,
    required: true,
    default: 0,
  },
  lastBlockTime: {
    type: Date,
    required: true,
    default: () => new Date(0),
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  collection: 'ingest_cursors',
  timestamps: false,
});

// Unique constraint per chain + feed + window
IngestCursorSchema.index(
  { chain: 1, feed: 1, window: 1 },
  { unique: true }
);

export const IngestCursorModel = mongoose.model<IIngestCursor>(
  'IngestCursor',
  IngestCursorSchema
);
