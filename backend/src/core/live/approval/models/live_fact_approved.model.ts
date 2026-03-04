/**
 * Live Fact Approved Model
 * 
 * Stores aggregates that have passed the Approval Gate.
 * ONLY APPROVED facts are visible to Drift / ML / Attribution.
 * 
 * NO interpretations, NO BUY/SELL, NO confidence.
 */
import mongoose from 'mongoose';
import type { ApprovalStatus, ApprovalMetrics } from '../approval.types.js';

export interface ILiveFactApproved {
  // Identity
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  
  // Window
  window: '1h' | '6h' | '24h';
  windowStart: Date;
  windowEnd: Date;
  
  // Metrics (pure numbers, no interpretation)
  metrics: ApprovalMetrics;
  
  // Approval info
  approval: {
    status: ApprovalStatus;
    score: number;
    failedRules: string[];
  };
  
  // Metadata
  sourceAggregateId?: string;
  approvedAt: Date;
}

const LiveFactApprovedSchema = new mongoose.Schema<ILiveFactApproved>({
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
  tokenSymbol: {
    type: String,
    required: true,
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
  metrics: {
    eventCount: { type: Number, required: true },
    volumeIn: { type: String, required: true },
    volumeOut: { type: String, required: true },
    netFlow: { type: String, required: true },
    uniqueSenders: { type: Number, required: true },
    uniqueReceivers: { type: Number, required: true },
    firstBlock: { type: Number, required: true },
    lastBlock: { type: Number, required: true },
  },
  approval: {
    status: {
      type: String,
      enum: ['APPROVED', 'QUARANTINED', 'REJECTED'],
      required: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    failedRules: {
      type: [String],
      default: [],
    },
  },
  sourceAggregateId: {
    type: String,
    required: false,
  },
  approvedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
}, {
  collection: 'live_facts_approved',
  timestamps: false,
});

// Unique index: one fact per (chain, token, window, windowStart)
LiveFactApprovedSchema.index(
  { chainId: 1, tokenAddress: 1, window: 1, windowStart: 1 },
  { unique: true }
);

// Query indexes
LiveFactApprovedSchema.index({ tokenAddress: 1, window: 1, windowStart: -1 });
LiveFactApprovedSchema.index({ 'approval.status': 1 });
LiveFactApprovedSchema.index({ approvedAt: -1 });
LiveFactApprovedSchema.index({ windowEnd: -1 });

export const LiveFactApprovedModel = mongoose.model<ILiveFactApproved>(
  'LiveFactApproved',
  LiveFactApprovedSchema
);
