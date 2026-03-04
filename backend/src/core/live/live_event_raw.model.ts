/**
 * Live Event Raw Model
 * 
 * Stores raw ERC20 Transfer events in quarantine.
 * This is the "RAW" layer - data here does NOT affect rankings/engine.
 */
import mongoose from 'mongoose';

export interface ILiveEventRaw {
  // Identity
  chainId: number;
  tokenAddress: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  
  // Transfer data
  from: string;
  to: string;
  amount: string;        // raw uint256 as string
  amountUSD?: number;    // optional if price snapshot available
  
  // Timing
  timestamp: Date;
  blockTimestamp?: number; // Unix timestamp from block
  
  // Actor matching (nullable)
  actorFromId?: string;
  actorToId?: string;
  
  // Tags
  tags: string[];        // ['to_exchange', 'from_exchange', 'actor_touch', ...]
  
  // Metadata
  ingestedAt: Date;
}

const LiveEventRawSchema = new mongoose.Schema<ILiveEventRaw>({
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
  blockNumber: {
    type: Number,
    required: true,
  },
  txHash: {
    type: String,
    required: true,
    lowercase: true,
  },
  logIndex: {
    type: Number,
    required: true,
  },
  from: {
    type: String,
    required: true,
    lowercase: true,
  },
  to: {
    type: String,
    required: true,
    lowercase: true,
  },
  amount: {
    type: String,
    required: true,
  },
  amountUSD: {
    type: Number,
    required: false,
  },
  timestamp: {
    type: Date,
    required: true,
  },
  blockTimestamp: {
    type: Number,
    required: false,
  },
  actorFromId: {
    type: String,
    required: false,
  },
  actorToId: {
    type: String,
    required: false,
  },
  tags: {
    type: [String],
    default: [],
  },
  ingestedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
}, {
  collection: 'live_raw_events',
  timestamps: false, // We use ingestedAt
});

// Uniqueness index (dedup)
LiveEventRawSchema.index(
  { chainId: 1, tokenAddress: 1, blockNumber: 1, logIndex: 1 },
  { unique: true }
);

// Query indexes
LiveEventRawSchema.index({ timestamp: 1 });
LiveEventRawSchema.index({ txHash: 1 });
LiveEventRawSchema.index({ tokenAddress: 1, timestamp: -1 });
LiveEventRawSchema.index({ ingestedAt: -1 });

export const LiveEventRawModel = mongoose.model<ILiveEventRaw>(
  'LiveEventRaw',
  LiveEventRawSchema
);
