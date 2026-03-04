/**
 * Block Window Service (P0.1)
 * 
 * Deterministic block window calculation.
 * Ensures no overlap, no gaps, consistent processing.
 */

import { IChainSyncState } from './chain_sync_state.model.js';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Default max blocks per window
  DEFAULT_MAX_WINDOW: 1000,
  
  // Per-chain overrides (slower chains get smaller windows)
  CHAIN_WINDOW_SIZE: {
    ETH: 500,      // Ethereum mainnet - more data per block
    ARB: 2000,     // Arbitrum - faster blocks
    OP: 2000,      // Optimism
    BASE: 2000,    // Base
    POLY: 1000,    // Polygon
    BNB: 1000,     // BNB Chain
    AVAX: 1000,    // Avalanche
    ZKSYNC: 500,   // zkSync - newer, be cautious
    SCROLL: 500,   // Scroll
    LINEA: 500     // Linea
  } as Record<string, number>,
  
  // Minimum window size (never go below this)
  MIN_WINDOW: 10,
  
  // Buffer from head (don't process too close to chain tip)
  HEAD_BUFFER: 5
};

// ============================================
// Types
// ============================================

export type WindowReason = 'NORMAL' | 'BACKFILL' | 'RECOVERY' | 'CATCHUP';

export interface BlockWindow {
  chain: string;
  fromBlock: number;
  toBlock: number;
  windowSize: number;
  reason: WindowReason;
  targetHead: number;
  lagAfterWindow: number;
}

export interface WindowValidation {
  valid: boolean;
  error?: string;
}

// ============================================
// Core Functions
// ============================================

/**
 * Calculate the next block window to process
 */
export function calculateNextWindow(
  chainState: IChainSyncState,
  currentHead: number,
  maxWindowOverride?: number
): BlockWindow | null {
  const chain = chainState.chain;
  const lastSynced = chainState.lastSyncedBlock;
  
  // Calculate safe head (buffer from tip)
  const safeHead = Math.max(0, currentHead - CONFIG.HEAD_BUFFER);
  
  // Nothing to do if we're caught up
  if (lastSynced >= safeHead) {
    return null;
  }
  
  // Determine window size
  const maxWindow = maxWindowOverride || 
    CONFIG.CHAIN_WINDOW_SIZE[chain] || 
    CONFIG.DEFAULT_MAX_WINDOW;
  
  // Calculate window
  const fromBlock = lastSynced + 1;
  const potentialToBlock = fromBlock + maxWindow - 1;
  const toBlock = Math.min(potentialToBlock, safeHead);
  const windowSize = toBlock - fromBlock + 1;
  
  // Determine reason based on lag
  const lag = safeHead - lastSynced;
  let reason: WindowReason = 'NORMAL';
  
  if (lag > maxWindow * 10) {
    reason = 'BACKFILL';
  } else if (lag > maxWindow * 3) {
    reason = 'CATCHUP';
  } else if (chainState.consecutiveErrors > 0) {
    reason = 'RECOVERY';
  }
  
  return {
    chain,
    fromBlock,
    toBlock,
    windowSize,
    reason,
    targetHead: safeHead,
    lagAfterWindow: safeHead - toBlock
  };
}

/**
 * Validate a block window
 */
export function validateWindow(
  window: BlockWindow,
  chainState: IChainSyncState
): WindowValidation {
  // Check basic validity
  if (window.fromBlock <= 0) {
    return { valid: false, error: 'fromBlock must be positive' };
  }
  
  if (window.toBlock < window.fromBlock) {
    return { valid: false, error: 'toBlock must be >= fromBlock' };
  }
  
  if (window.windowSize < CONFIG.MIN_WINDOW && window.windowSize !== (window.toBlock - window.fromBlock + 1)) {
    return { valid: false, error: `Window size below minimum (${CONFIG.MIN_WINDOW})` };
  }
  
  // Check continuity - no gaps allowed
  if (window.fromBlock !== chainState.lastSyncedBlock + 1) {
    return { 
      valid: false, 
      error: `Gap detected: expected fromBlock ${chainState.lastSyncedBlock + 1}, got ${window.fromBlock}` 
    };
  }
  
  // Check no overlap (fromBlock should be after lastSynced)
  if (window.fromBlock <= chainState.lastSyncedBlock) {
    return { 
      valid: false, 
      error: `Overlap detected: fromBlock ${window.fromBlock} <= lastSynced ${chainState.lastSyncedBlock}` 
    };
  }
  
  return { valid: true };
}

/**
 * Detect gaps in block sequence
 */
export function detectGap(
  chainState: IChainSyncState,
  expectedNextBlock: number
): { hasGap: boolean; gapStart?: number; gapEnd?: number } {
  const lastSynced = chainState.lastSyncedBlock;
  const nextExpected = lastSynced + 1;
  
  if (expectedNextBlock > nextExpected) {
    return {
      hasGap: true,
      gapStart: nextExpected,
      gapEnd: expectedNextBlock - 1
    };
  }
  
  return { hasGap: false };
}

/**
 * Split a large range into multiple windows
 */
export function splitIntoWindows(
  chain: string,
  fromBlock: number,
  toBlock: number,
  maxWindowSize?: number
): Array<{ fromBlock: number; toBlock: number }> {
  const windowSize = maxWindowSize || 
    CONFIG.CHAIN_WINDOW_SIZE[chain] || 
    CONFIG.DEFAULT_MAX_WINDOW;
  
  const windows: Array<{ fromBlock: number; toBlock: number }> = [];
  let current = fromBlock;
  
  while (current <= toBlock) {
    const windowEnd = Math.min(current + windowSize - 1, toBlock);
    windows.push({
      fromBlock: current,
      toBlock: windowEnd
    });
    current = windowEnd + 1;
  }
  
  return windows;
}

/**
 * Estimate time to sync based on current progress
 */
export function estimateSyncTime(
  chainState: IChainSyncState,
  currentHead: number
): { blocksRemaining: number; estimatedMinutes: number } | null {
  const lag = currentHead - chainState.lastSyncedBlock;
  
  if (lag <= 0) {
    return null;
  }
  
  // Use average latency to estimate (assuming latency includes full window processing)
  const avgLatencyMs = chainState.avgLatencyMs || 1000;
  const windowSize = CONFIG.CHAIN_WINDOW_SIZE[chainState.chain] || CONFIG.DEFAULT_MAX_WINDOW;
  
  const windowsRemaining = Math.ceil(lag / windowSize);
  const estimatedMs = windowsRemaining * avgLatencyMs;
  
  return {
    blocksRemaining: lag,
    estimatedMinutes: Math.ceil(estimatedMs / 60000)
  };
}

/**
 * Get optimal window size for current conditions
 */
export function getOptimalWindowSize(
  chain: string,
  errorRate: number,
  latencyMs: number
): number {
  const baseSize = CONFIG.CHAIN_WINDOW_SIZE[chain] || CONFIG.DEFAULT_MAX_WINDOW;
  
  // Reduce window size if we're seeing errors
  if (errorRate > 0.1) {
    return Math.max(CONFIG.MIN_WINDOW, Math.floor(baseSize * 0.5));
  }
  
  if (errorRate > 0.05) {
    return Math.max(CONFIG.MIN_WINDOW, Math.floor(baseSize * 0.75));
  }
  
  // Reduce if latency is high
  if (latencyMs > 10000) {
    return Math.max(CONFIG.MIN_WINDOW, Math.floor(baseSize * 0.5));
  }
  
  if (latencyMs > 5000) {
    return Math.max(CONFIG.MIN_WINDOW, Math.floor(baseSize * 0.75));
  }
  
  return baseSize;
}

// ============================================
// Exports
// ============================================

export { CONFIG as WINDOW_CONFIG };
