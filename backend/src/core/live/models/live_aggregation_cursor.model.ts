/**
 * Live Aggregation Cursor Model
 * 
 * Tracks aggregation progress separately from ingestion cursor.
 * Enables idempotent and resumable aggregation.
 * 
 * One cursor per (tokenAddress, window) pair.
 */
import mongoose from 'mongoose';
import type { WindowSize } from './live_aggregate_window.model.js';

export interface ILiveAggregationCursor {
  tokenAddress: string;
  window: WindowSize;
  
  // Last successfully aggregated window
  lastWindowEnd: Date;
  
  // Block tracking for debugging
  lastProcessedBlock: number;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

const LiveAggregationCursorSchema = new mongoose.Schema<ILiveAggregationCursor>({
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  window: {
    type: String,
    enum: ['1h', '6h', '24h'],
    required: true,
  },
  lastWindowEnd: {
    type: Date,
    required: true,
  },
  lastProcessedBlock: {
    type: Number,
    required: true,
    default: 0,
  },
}, {
  collection: 'live_aggregation_cursors',
  timestamps: true,
});

// Unique index: one cursor per (token, window)
LiveAggregationCursorSchema.index(
  { tokenAddress: 1, window: 1 },
  { unique: true }
);

export const LiveAggregationCursorModel = mongoose.model<ILiveAggregationCursor>(
  'LiveAggregationCursor',
  LiveAggregationCursorSchema
);
