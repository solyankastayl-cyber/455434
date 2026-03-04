/**
 * S10.W Step 2 — Whale Provider Interface
 * 
 * Contract for all whale data providers.
 * Providers are SENSORS, not brains.
 * 
 * LOCKED — Do not modify without explicit approval
 */

import {
  LargePositionSnapshot,
  WhaleEvent,
  WhaleSourceHealth,
  ExchangeId,
} from '../whale.types.js';

// ═══════════════════════════════════════════════════════════════
// PROVIDER INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface WhaleProviderConfig {
  /** Symbols to track (e.g., ['BTC', 'ETH', 'SOL']) */
  symbols: string[];
  
  /** Minimum position size in USD to be considered "whale" */
  minPositionUsd: number;
  
  /** Polling interval in milliseconds */
  pollingIntervalMs: number;
  
  /** Maximum positions to fetch per symbol */
  maxPositionsPerSymbol: number;
  
  /** Enable/disable the provider */
  enabled: boolean;
  
  /** Whale addresses to track (Hyperliquid-specific) */
  whaleAddresses?: string[];
  
  /** Use mock data generation when no real addresses configured */
  useMockFallback?: boolean;
}

export interface WhaleProviderStatus {
  id: ExchangeId;
  enabled: boolean;
  running: boolean;
  health: WhaleSourceHealth;
  config: WhaleProviderConfig;
  stats: {
    lastFetchAt: number;
    lastFetchDurationMs: number;
    totalFetches: number;
    totalErrors: number;
    positionsTracked: number;
  };
}

export interface FetchSnapshotsParams {
  symbols?: string[];
  minPositionUsd?: number;
  limit?: number;
}

export interface FetchSnapshotsResult {
  snapshots: LargePositionSnapshot[];
  fetchedAt: number;
  durationMs: number;
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════
// WHALE PROVIDER CONTRACT
// ═══════════════════════════════════════════════════════════════

export interface IWhaleProvider {
  /** Provider identifier */
  readonly id: ExchangeId;
  
  /** Get current health status */
  health(): WhaleSourceHealth;
  
  /** Get current configuration */
  getConfig(): WhaleProviderConfig;
  
  /** Update configuration */
  updateConfig(config: Partial<WhaleProviderConfig>): void;
  
  /** Get provider status */
  getStatus(): WhaleProviderStatus;
  
  /**
   * Fetch current whale positions.
   * This is the main data fetching method.
   * Returns raw snapshots — no business logic.
   */
  fetchSnapshots(params?: FetchSnapshotsParams): Promise<FetchSnapshotsResult>;
  
  /**
   * Start polling for whale data.
   * Runs in background until stopped.
   */
  start(): Promise<void>;
  
  /**
   * Stop polling.
   */
  stop(): Promise<void>;
  
  /**
   * Check if provider is running.
   */
  isRunning(): boolean;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_WHALE_PROVIDER_CONFIG: WhaleProviderConfig = {
  symbols: ['BTC', 'ETH', 'SOL'],
  minPositionUsd: 100_000, // $100K minimum
  pollingIntervalMs: 30_000, // 30 seconds
  maxPositionsPerSymbol: 50,
  enabled: true,
  whaleAddresses: [],
  useMockFallback: true, // Use mock data when no real addresses
};

console.log('[S10.W] Whale Provider Interface loaded');
