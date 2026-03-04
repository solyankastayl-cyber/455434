/**
 * Drift Cursor Model
 * 
 * Tracks drift computation progress.
 * One cursor per (tokenAddress, window).
 */
import mongoose from 'mongoose';

export interface ILiveDriftCursor {
  tokenAddress: string;
  window: '1h' | '6h' | '24h';
  lastComputedWindowEnd: Date;
  lastComputedAt: Date;
}

const LiveDriftCursorSchema = new mongoose.Schema<ILiveDriftCursor>({
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
  lastComputedWindowEnd: {
    type: Date,
    required: true,
  },
  lastComputedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
}, {
  collection: 'live_drift_cursors',
  timestamps: false,
});

// Unique index
LiveDriftCursorSchema.index(
  { tokenAddress: 1, window: 1 },
  { unique: true }
);

export const LiveDriftCursorModel = mongoose.model<ILiveDriftCursor>(
  'LiveDriftCursor',
  LiveDriftCursorSchema
);
