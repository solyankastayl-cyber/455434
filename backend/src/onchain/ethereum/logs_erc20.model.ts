/**
 * ERC-20 Transfer Logs Model
 * Raw Transfer events from Ethereum blockchain
 * 
 * This is RAW data - no analytics, just facts:
 * - Who sent tokens
 * - Who received tokens  
 * - How much
 * - When
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IERC20Log extends Document {
  // Block info
  blockNumber: number;
  blockTimestamp: Date;
  
  // Transaction info
  txHash: string;
  logIndex: number;
  
  // Transfer data
  token: string;      // Token contract address (lowercase)
  from: string;       // Sender address (lowercase)
  to: string;         // Receiver address (lowercase)
  amount: string;     // Raw amount as string (to handle big numbers)
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

const ERC20LogSchema = new Schema<IERC20Log>(
  {
    // Block info
    blockNumber: {
      type: Number,
      required: true,
      index: true,
    },
    blockTimestamp: {
      type: Date,
      required: true,
      index: true,
    },
    
    // Transaction info
    txHash: {
      type: String,
      required: true,
      lowercase: true,
    },
    logIndex: {
      type: Number,
      required: true,
    },
    
    // Transfer data
    token: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    from: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    to: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    amount: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'logs_erc20',
  }
);

// Compound indexes for efficient queries
ERC20LogSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
ERC20LogSchema.index({ from: 1, blockNumber: -1 });
ERC20LogSchema.index({ to: 1, blockNumber: -1 });
ERC20LogSchema.index({ token: 1, blockNumber: -1 });
ERC20LogSchema.index({ blockNumber: -1, logIndex: 1 });

export const ERC20LogModel = mongoose.model<IERC20Log>('ERC20Log', ERC20LogSchema);
