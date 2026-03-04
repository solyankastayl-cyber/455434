/**
 * Live Aggregate Window Model
 * 
 * Stores deterministic time-window aggregates computed from RAW events.
 * This is pure math + time - NO interpretations, confidence, or risk.
 * 
 * LI-3 reads ONLY from LiveEventRaw
 * LI-3 writes ONLY to LiveAggregateWindow
 */
import mongoose from 'mongoose';

export type WindowSize = '1h' | '6h' | '24h';

export interface ILiveAggregateWindow {
  // Identity
  chainId: number;
  tokenAddress: string;
  
  // Window definition
  window: WindowSize;
  windowStart: Date;
  windowEnd: Date;
  
  // Flow metrics (raw counts)
  inflowCount: number;
  outflowCount: number;
  
  // Flow amounts (as string for precision)
  inflowAmount: string;
  outflowAmount: string;
  netFlowAmount: string;
  
  // Actor metrics
  uniqueSenders: number;
  uniqueReceivers: number;
  
  // Event coverage
  eventCount: number;
  firstBlock: number;
  lastBlock: number;
  
  // Metadata
  computedAt: Date;
}

const LiveAggregateWindowSchema = new mongoose.Schema<ILiveAggregateWindow>({
  chainId: {
    type: Number,
    required: true,
    default: 1,
  },
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
  windowStart: {
    type: Date,
    required: true,
  },
  windowEnd: {
    type: Date,
    required: true,
  },
  
  // Flow metrics
  inflowCount: {
    type: Number,
    required: true,
    default: 0,
  },
  outflowCount: {
    type: Number,
    required: true,
    default: 0,
  },
  inflowAmount: {
    type: String,
    required: true,
    default: '0',
  },
  outflowAmount: {
    type: String,
    required: true,
    default: '0',
  },
  netFlowAmount: {
    type: String,
    required: true,
    default: '0',
  },
  
  // Actor metrics
  uniqueSenders: {
    type: Number,
    required: true,
    default: 0,
  },
  uniqueReceivers: {
    type: Number,
    required: true,
    default: 0,
  },
  
  // Event coverage
  eventCount: {
    type: Number,
    required: true,
    default: 0,
  },
  firstBlock: {
    type: Number,
    required: true,
    default: 0,
  },
  lastBlock: {
    type: Number,
    required: true,
    default: 0,
  },
  
  // Metadata
  computedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
}, {
  collection: 'live_aggregate_windows',
  timestamps: false,
});

// Unique index: one aggregate per (chain, token, window, windowStart)
LiveAggregateWindowSchema.index(
  { chainId: 1, tokenAddress: 1, window: 1, windowStart: 1 },
  { unique: true }
);

// Query indexes
LiveAggregateWindowSchema.index({ tokenAddress: 1, window: 1, windowStart: -1 });
LiveAggregateWindowSchema.index({ windowEnd: -1 });
LiveAggregateWindowSchema.index({ computedAt: -1 });

export const LiveAggregateWindowModel = mongoose.model<ILiveAggregateWindow>(
  'LiveAggregateWindow',
  LiveAggregateWindowSchema
);
