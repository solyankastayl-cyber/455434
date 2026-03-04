/**
 * ETAP 6.1 — Raw Transfers Model
 * 
 * Append-only storage for ERC-20 Transfer events.
 * This is the foundation for all aggregation and signal generation.
 * 
 * Key design:
 * - Unique constraint on (chain, txHash, logIndex) prevents duplicates
 * - Indexed by time windows for efficient aggregation queries
 * - Minimal fields for low storage footprint
 */
import mongoose from 'mongoose';

export interface IRawTransfer {
  chain: string;                    // 'ethereum' | 'base' | 'arbitrum'
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTime: Date;
  
  from: string;                     // lowercased
  to: string;                       // lowercased
  token: string;                    // token contract lowercased
  
  amountRaw: string;                // BigInt as string
  amountUsd: number | null;         // optional price at time
  decimals: number | null;          // token decimals
  symbol: string | null;            // token symbol
  
  source: 'rpc' | 'indexer';
  createdAt: Date;
}

const RawTransferSchema = new mongoose.Schema<IRawTransfer>({
  chain: {
    type: String,
    required: true,
    default: 'ethereum',
    enum: ['ethereum', 'base', 'arbitrum', 'polygon'],
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
  blockNumber: {
    type: Number,
    required: true,
    index: true,
  },
  blockTime: {
    type: Date,
    required: true,
    index: true,
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
  token: {
    type: String,
    required: true,
    lowercase: true,
  },
  amountRaw: {
    type: String,
    required: true,
  },
  amountUsd: {
    type: Number,
    default: null,
  },
  decimals: {
    type: Number,
    default: null,
  },
  symbol: {
    type: String,
    default: null,
  },
  source: {
    type: String,
    enum: ['rpc', 'indexer'],
    default: 'rpc',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  collection: 'raw_transfers',
  timestamps: false,
});

// CRITICAL: Unique constraint to prevent duplicates
RawTransferSchema.index(
  { chain: 1, txHash: 1, logIndex: 1 },
  { unique: true }
);

// Query indexes for time-based aggregations
RawTransferSchema.index({ chain: 1, blockTime: -1 });
RawTransferSchema.index({ chain: 1, from: 1, blockTime: -1 });
RawTransferSchema.index({ chain: 1, to: 1, blockTime: -1 });
RawTransferSchema.index({ chain: 1, token: 1, blockTime: -1 });

export const RawTransferModel = mongoose.model<IRawTransfer>(
  'RawTransfer',
  RawTransferSchema
);
