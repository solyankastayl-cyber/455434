/**
 * Route Segment Model (P0.3)
 * 
 * Individual segment of a liquidity route.
 * A route consists of multiple segments forming a path.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type SegmentType = 
  | 'TRANSFER'      // Simple transfer
  | 'BRIDGE'        // Cross-chain bridge
  | 'SWAP'          // DEX swap
  | 'CEX_DEPOSIT'   // Deposit to exchange
  | 'CEX_WITHDRAW'  // Withdrawal from exchange
  | 'CONTRACT';     // Contract interaction

export interface IRouteSegment {
  routeId: string;
  index: number;            // Position in route (0, 1, 2...)
  
  // Segment type
  type: SegmentType;
  
  // Chain info
  chainFrom: string;        // Source chain
  chainTo?: string;         // Destination chain (for bridges)
  
  // Transaction details
  txHash: string;
  blockNumber: number;
  timestamp: Date;
  
  // Wallet info
  walletFrom: string;       // Sender
  walletTo: string;         // Receiver
  
  // Token info
  tokenAddress: string;
  tokenSymbol?: string;
  amount: string;           // String for precision
  amountUsd?: number;
  
  // Protocol info
  protocol?: string;        // Stargate, Hop, Uniswap, etc.
  protocolType?: string;    // BRIDGE, DEX, etc.
  
  // Labels (from P0.2)
  fromLabel?: string;       // Label of sender
  toLabel?: string;         // Label of receiver (e.g., "Binance Hot Wallet")
  
  // Confidence for this segment
  confidence: number;       // 0-1
}

export interface IRouteSegmentDocument extends IRouteSegment, Document {}

// ============================================
// Schema
// ============================================

const RouteSegmentSchema = new Schema<IRouteSegmentDocument>({
  routeId: { type: String, required: true, index: true },
  index: { type: Number, required: true },
  
  type: { 
    type: String, 
    enum: ['TRANSFER', 'BRIDGE', 'SWAP', 'CEX_DEPOSIT', 'CEX_WITHDRAW', 'CONTRACT'],
    required: true 
  },
  
  chainFrom: { type: String, required: true },
  chainTo: { type: String },
  
  txHash: { type: String, required: true },
  blockNumber: { type: Number, required: true },
  timestamp: { type: Date, required: true },
  
  walletFrom: { type: String, required: true, lowercase: true },
  walletTo: { type: String, required: true, lowercase: true },
  
  tokenAddress: { type: String, required: true, lowercase: true },
  tokenSymbol: { type: String },
  amount: { type: String, required: true },
  amountUsd: { type: Number },
  
  protocol: { type: String },
  protocolType: { type: String },
  
  fromLabel: { type: String },
  toLabel: { type: String },
  
  confidence: { type: Number, default: 0.5 }
});

// Compound indexes
RouteSegmentSchema.index({ routeId: 1, index: 1 }, { unique: true });
RouteSegmentSchema.index({ walletFrom: 1, timestamp: 1 });
RouteSegmentSchema.index({ walletTo: 1, timestamp: 1 });
RouteSegmentSchema.index({ chainFrom: 1, type: 1 });

export const RouteSegmentModel = mongoose.model<IRouteSegmentDocument>(
  'route_segment',
  RouteSegmentSchema
);
