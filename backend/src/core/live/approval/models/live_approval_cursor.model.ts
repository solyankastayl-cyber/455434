/**
 * Live Approval Cursor Model
 * 
 * Tracks approval progress separately from ingestion and aggregation.
 * One cursor per (tokenAddress, window) pair.
 */
import mongoose from 'mongoose';

export interface ILiveApprovalCursor {
  tokenAddress: string;
  window: '1h' | '6h' | '24h';
  lastApprovedWindowEnd: Date;
  lastProcessedAt: Date;
}

const LiveApprovalCursorSchema = new mongoose.Schema<ILiveApprovalCursor>({
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
  lastApprovedWindowEnd: {
    type: Date,
    required: true,
  },
  lastProcessedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
}, {
  collection: 'live_approval_cursors',
  timestamps: false,
});

// Unique index: one cursor per (token, window)
LiveApprovalCursorSchema.index(
  { tokenAddress: 1, window: 1 },
  { unique: true }
);

export const LiveApprovalCursorModel = mongoose.model<ILiveApprovalCursor>(
  'LiveApprovalCursor',
  LiveApprovalCursorSchema
);
