/**
 * Chain Sync State Model (P0.1)
 * 
 * Single Source of Truth for ingestion progress per chain.
 * Tracks where we are, what's happening, and system health.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type ChainStatus = 'OK' | 'DEGRADED' | 'PAUSED' | 'ERROR';

export interface IChainSyncState {
  chain: string;              // ETH, ARB, OP, BASE...
  chainId: number;            // 1, 42161, 10, 8453...
  
  // Progress tracking
  lastSyncedBlock: number;    // Last successfully processed block
  lastHeadBlock: number;      // Latest known block on chain
  
  // Status
  status: ChainStatus;
  pauseReason?: string;       // Why paused (if applicable)
  
  // Error tracking (rolling window)
  errorCount: number;         // Errors in current window
  consecutiveErrors: number;  // Consecutive errors (reset on success)
  lastError?: string;         // Last error message
  lastErrorAt?: Date;
  
  // Success tracking
  lastSuccessAt?: Date;
  totalEventsIngested: number;
  
  // Performance metrics
  avgEventsPerBlock: number;
  avgLatencyMs: number;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface IChainSyncStateDocument extends IChainSyncState, Document {}

// ============================================
// Schema
// ============================================

const ChainSyncStateSchema = new Schema<IChainSyncStateDocument>({
  chain: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true,
    uppercase: true
  },
  chainId: { type: Number, required: true },
  
  lastSyncedBlock: { type: Number, default: 0 },
  lastHeadBlock: { type: Number, default: 0 },
  
  status: { 
    type: String, 
    enum: ['OK', 'DEGRADED', 'PAUSED', 'ERROR'],
    default: 'OK'
  },
  pauseReason: { type: String },
  
  errorCount: { type: Number, default: 0 },
  consecutiveErrors: { type: Number, default: 0 },
  lastError: { type: String },
  lastErrorAt: { type: Date },
  
  lastSuccessAt: { type: Date },
  totalEventsIngested: { type: Number, default: 0 },
  
  avgEventsPerBlock: { type: Number, default: 0 },
  avgLatencyMs: { type: Number, default: 0 },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
ChainSyncStateSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export const ChainSyncStateModel = mongoose.model<IChainSyncStateDocument>(
  'chain_sync_state',
  ChainSyncStateSchema
);

// ============================================
// Chain Configuration
// ============================================

export const CHAIN_CONFIG: Record<string, { chainId: number; name: string; rpcWeight: number }> = {
  ETH: { chainId: 1, name: 'Ethereum', rpcWeight: 1 },
  ARB: { chainId: 42161, name: 'Arbitrum', rpcWeight: 2 },
  OP: { chainId: 10, name: 'Optimism', rpcWeight: 2 },
  BASE: { chainId: 8453, name: 'Base', rpcWeight: 2 },
  POLY: { chainId: 137, name: 'Polygon', rpcWeight: 2 },
  BNB: { chainId: 56, name: 'BNB Chain', rpcWeight: 2 },
  AVAX: { chainId: 43114, name: 'Avalanche', rpcWeight: 2 },
  ZKSYNC: { chainId: 324, name: 'zkSync Era', rpcWeight: 3 },
  SCROLL: { chainId: 534352, name: 'Scroll', rpcWeight: 3 },
  LINEA: { chainId: 59144, name: 'Linea', rpcWeight: 3 }
};

export const SUPPORTED_CHAINS = Object.keys(CHAIN_CONFIG);
