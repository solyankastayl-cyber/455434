/**
 * Chain Adapter Types (P2.3.1.A)
 * 
 * Common interfaces for all chain adapters
 */

import type { UnifiedChainEvent } from '../../cross_chain/storage/unified_events.model.js';

// ============================================
// Chain Configuration
// ============================================

export interface ChainConfig {
  name: string;
  chainId: number | string;
  rpcUrls: string[];
  nativeToken: {
    symbol: string;
    decimals: number;
  };
  explorer?: string;
}

// ============================================
// Raw Event (before normalization)
// ============================================

export interface RawChainEvent {
  txHash: string;
  blockNumber: number;
  timestamp: number;
  
  from: string;
  to: string;
  
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  
  value: string;
  valueUsd?: number;
  
  logIndex?: number;
  transactionIndex?: number;
}

// ============================================
// Chain Adapter Interface
// ============================================

export interface IChainAdapter {
  /**
   * Chain configuration
   */
  getConfig(): ChainConfig;
  
  /**
   * Fetch events from block range
   */
  fetchEvents(startBlock: number, endBlock: number): Promise<RawChainEvent[]>;
  
  /**
   * Normalize raw events to unified format
   */
  normalizeEvents(rawEvents: RawChainEvent[]): Omit<UnifiedChainEvent, 'eventId' | 'createdAt'>[];
  
  /**
   * Get latest block number
   */
  getLatestBlockNumber(): Promise<number>;
  
  /**
   * Get block timestamp
   */
  getBlockTimestamp(blockNumber: number): Promise<number>;
}

// ============================================
// Adapter Options
// ============================================

export interface AdapterOptions {
  rpcUrl?: string;
  rpcFallbacks?: string[];
  batchSize?: number;
  retries?: number;
  timeout?: number;
}
