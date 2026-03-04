/**
 * Normalized Transfers Model
 * 
 * This is the UNIFIED layer between raw on-chain data and analytics.
 * ALL analytics modules (relations, bundles, scores, signals) read from here.
 * 
 * Key principle: ONE log/tx = ONE transfer (no aggregations)
 * 
 * Abstracts sources:
 * - ERC-20 transfers (from logs_erc20)
 * - ETH transfers (from eth_tx - future)
 * - Internal transactions (future)
 * - DEX swaps (future)
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Asset type enum
 */
export type AssetType = 'erc20' | 'eth' | 'internal' | 'swap';

/**
 * Direction of transfer relative to an address
 */
export type TransferDirection = 'in' | 'out';

/**
 * Source of the transfer data
 */
export type TransferSource = 'erc20_log' | 'eth_tx' | 'internal_tx' | 'dex_swap';

/**
 * Supported chains - P0 MULTICHAIN
 */
export type Chain = 'ethereum' | 'arbitrum' | 'optimism' | 'base' | 'polygon' | 'bnb' | 'zksync' | 'scroll';

/**
 * Transfer type - includes bridges
 */
export type TransferType = 'TRANSFER' | 'BRIDGE_IN' | 'BRIDGE_OUT';

/**
 * Transfer Document Interface
 */
export interface ITransfer extends Document {
  _id: Types.ObjectId;
  
  // Transaction identification
  txHash: string;
  logIndex: number | null;  // null for ETH native transfers
  blockNumber: number;
  timestamp: Date;
  
  // Participants
  from: string;  // lowercase address
  to: string;    // lowercase address
  
  // Asset info
  assetType: AssetType;
  assetAddress: string;  // token address or 'ETH' for native
  amountRaw: string;     // BigInt as string (no precision loss)
  amountNormalized: number | null;  // Decimal-adjusted (null until decimals known)
  
  // Chain info
  chain: Chain;
  
  // Source tracking (for debugging & incremental updates)
  source: TransferSource;
  sourceId: string;  // Reference to source document (_id or txHash+logIndex)
  
  // Processing status
  processed: boolean;  // Has been processed by relations/bundles
  processedAt: Date | null;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Transfer Schema
 */
const TransferSchema = new Schema<ITransfer>(
  {
    // Transaction identification
    txHash: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    logIndex: {
      type: Number,
      default: null,
    },
    blockNumber: {
      type: Number,
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    
    // Participants
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
    
    // Asset info
    assetType: {
      type: String,
      enum: ['erc20', 'eth', 'internal', 'swap'],
      required: true,
      index: true,
    },
    assetAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    amountRaw: {
      type: String,
      required: true,
    },
    amountNormalized: {
      type: Number,
      default: null,
    },
    
    // Chain info - P0 MULTICHAIN (8 networks)
    chain: {
      type: String,
      enum: ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'bnb', 'zksync', 'scroll'],
      required: true,
      index: true,
    },
    
    // Transfer type - includes bridges
    transferType: {
      type: String,
      enum: ['TRANSFER', 'BRIDGE_IN', 'BRIDGE_OUT'],
      default: 'TRANSFER',
      index: true,
    },
    
    // Bridge info (for BRIDGE_IN/BRIDGE_OUT)
    bridgeInfo: {
      bridgeName: { type: String },
      fromNetwork: { type: String },
      toNetwork: { type: String },
    },
    
    // Source tracking
    source: {
      type: String,
      enum: ['erc20_log', 'eth_tx', 'internal_tx', 'dex_swap'],
      required: true,
    },
    sourceId: {
      type: String,
      required: true,
    },
    
    // Processing status
    processed: {
      type: Boolean,
      default: false,
      index: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'transfers',
  }
);

// ========== INDEXES ==========
// Critical for graph operations

// Unique transfer identification
TransferSchema.index(
  { txHash: 1, logIndex: 1, source: 1 },
  { unique: true }
);

// For graph traversal (relations, bundles)
TransferSchema.index({ from: 1, to: 1, timestamp: -1 });
TransferSchema.index({ from: 1, timestamp: -1 });
TransferSchema.index({ to: 1, timestamp: -1 });

// For asset-specific queries
TransferSchema.index({ assetAddress: 1, timestamp: -1 });
TransferSchema.index({ assetAddress: 1, from: 1, timestamp: -1 });
TransferSchema.index({ assetAddress: 1, to: 1, timestamp: -1 });

// For processing jobs
TransferSchema.index({ processed: 1, timestamp: -1 });
TransferSchema.index({ source: 1, processed: 1 });

// For netflow calculations
TransferSchema.index({ from: 1, assetAddress: 1, timestamp: -1 });
TransferSchema.index({ to: 1, assetAddress: 1, timestamp: -1 });

export const TransferModel = mongoose.model<ITransfer>('Transfer', TransferSchema);
