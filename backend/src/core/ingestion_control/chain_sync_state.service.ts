/**
 * Chain Sync State Service (P0.1)
 * 
 * Manages chain synchronization state - the single source of truth
 * for ingestion progress across all chains.
 */

import {
  ChainSyncStateModel,
  IChainSyncState,
  IChainSyncStateDocument,
  ChainStatus,
  CHAIN_CONFIG,
  SUPPORTED_CHAINS
} from './chain_sync_state.model.js';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  ERROR_THRESHOLD: 10,           // Errors before DEGRADED
  CONSECUTIVE_ERROR_PAUSE: 5,    // Consecutive errors before auto-pause
  ERROR_WINDOW_MS: 5 * 60 * 1000, // 5 minute rolling window
  LAG_DEGRADED_THRESHOLD: 100,   // Blocks behind before DEGRADED
  LAG_CRITICAL_THRESHOLD: 500    // Blocks behind before ERROR
};

// ============================================
// Core Operations
// ============================================

/**
 * Get current state for a chain
 */
export async function getChainState(chain: string): Promise<IChainSyncStateDocument | null> {
  return ChainSyncStateModel.findOne({ chain: chain.toUpperCase() }).lean();
}

/**
 * Get all chain states
 */
export async function getAllChainStates(): Promise<IChainSyncStateDocument[]> {
  return ChainSyncStateModel.find({}).sort({ chain: 1 }).lean();
}

/**
 * Initialize chain state (idempotent)
 */
export async function initChain(
  chain: string,
  startBlock: number = 0
): Promise<IChainSyncStateDocument> {
  const chainUpper = chain.toUpperCase();
  const config = CHAIN_CONFIG[chainUpper];
  
  if (!config) {
    throw new Error(`Unknown chain: ${chain}`);
  }
  
  const existing = await ChainSyncStateModel.findOne({ chain: chainUpper });
  if (existing) {
    console.log(`[SyncState] Chain ${chainUpper} already initialized at block ${existing.lastSyncedBlock}`);
    return existing;
  }
  
  const state = await ChainSyncStateModel.create({
    chain: chainUpper,
    chainId: config.chainId,
    lastSyncedBlock: startBlock,
    lastHeadBlock: startBlock,
    status: 'OK',
    errorCount: 0,
    consecutiveErrors: 0,
    totalEventsIngested: 0,
    avgEventsPerBlock: 0,
    avgLatencyMs: 0
  });
  
  console.log(`[SyncState] Initialized ${chainUpper} at block ${startBlock}`);
  return state;
}

/**
 * Initialize all supported chains
 */
export async function initAllChains(startBlocks?: Record<string, number>): Promise<void> {
  for (const chain of SUPPORTED_CHAINS) {
    const startBlock = startBlocks?.[chain] || 0;
    await initChain(chain, startBlock);
  }
  console.log(`[SyncState] All ${SUPPORTED_CHAINS.length} chains initialized`);
}

// ============================================
// Progress Updates
// ============================================

interface SyncSuccessStats {
  eventsIngested: number;
  latencyMs: number;
}

/**
 * Update state after successful sync
 */
export async function updateOnSuccess(
  chain: string,
  fromBlock: number,
  toBlock: number,
  headBlock: number,
  stats: SyncSuccessStats
): Promise<IChainSyncStateDocument> {
  const chainUpper = chain.toUpperCase();
  const blocksProcessed = toBlock - fromBlock + 1;
  
  const state = await ChainSyncStateModel.findOneAndUpdate(
    { chain: chainUpper },
    {
      $set: {
        lastSyncedBlock: toBlock,
        lastHeadBlock: headBlock,
        lastSuccessAt: new Date(),
        consecutiveErrors: 0,
        updatedAt: new Date(),
        // Calculate rolling average
        avgEventsPerBlock: stats.eventsIngested / blocksProcessed,
        avgLatencyMs: stats.latencyMs
      },
      $inc: {
        totalEventsIngested: stats.eventsIngested
      }
    },
    { new: true, upsert: false }
  );
  
  if (!state) {
    throw new Error(`Chain state not found: ${chainUpper}`);
  }
  
  // Update status based on lag
  const lag = headBlock - toBlock;
  let newStatus: ChainStatus = 'OK';
  
  if (lag > CONFIG.LAG_CRITICAL_THRESHOLD) {
    newStatus = 'ERROR';
  } else if (lag > CONFIG.LAG_DEGRADED_THRESHOLD) {
    newStatus = 'DEGRADED';
  }
  
  if (state.status !== 'PAUSED' && state.status !== newStatus) {
    await ChainSyncStateModel.updateOne(
      { chain: chainUpper },
      { $set: { status: newStatus } }
    );
  }
  
  return state;
}

/**
 * Update state after error
 */
export async function updateOnError(
  chain: string,
  error: Error | string
): Promise<{ state: IChainSyncStateDocument; shouldPause: boolean }> {
  const chainUpper = chain.toUpperCase();
  const errorMessage = typeof error === 'string' ? error : error.message;
  
  const state = await ChainSyncStateModel.findOneAndUpdate(
    { chain: chainUpper },
    {
      $set: {
        lastError: errorMessage,
        lastErrorAt: new Date(),
        updatedAt: new Date()
      },
      $inc: {
        errorCount: 1,
        consecutiveErrors: 1
      }
    },
    { new: true }
  );
  
  if (!state) {
    throw new Error(`Chain state not found: ${chainUpper}`);
  }
  
  // Determine if we should auto-pause
  const shouldPause = state.consecutiveErrors >= CONFIG.CONSECUTIVE_ERROR_PAUSE;
  
  if (shouldPause && state.status !== 'PAUSED') {
    await pauseChain(chainUpper, `Auto-paused after ${state.consecutiveErrors} consecutive errors: ${errorMessage}`);
  } else if (state.errorCount >= CONFIG.ERROR_THRESHOLD && state.status === 'OK') {
    await ChainSyncStateModel.updateOne(
      { chain: chainUpper },
      { $set: { status: 'DEGRADED' } }
    );
  }
  
  console.log(`[SyncState] Error on ${chainUpper}: ${errorMessage} (consecutive: ${state.consecutiveErrors})`);
  
  return { state, shouldPause };
}

/**
 * Update head block (latest known block on chain)
 */
export async function updateHeadBlock(chain: string, headBlock: number): Promise<void> {
  await ChainSyncStateModel.updateOne(
    { chain: chain.toUpperCase() },
    { $set: { lastHeadBlock: headBlock, updatedAt: new Date() } }
  );
}

// ============================================
// Pause / Resume
// ============================================

/**
 * Pause chain ingestion
 */
export async function pauseChain(chain: string, reason: string): Promise<IChainSyncStateDocument> {
  const chainUpper = chain.toUpperCase();
  
  const state = await ChainSyncStateModel.findOneAndUpdate(
    { chain: chainUpper },
    {
      $set: {
        status: 'PAUSED',
        pauseReason: reason,
        updatedAt: new Date()
      }
    },
    { new: true }
  );
  
  if (!state) {
    throw new Error(`Chain state not found: ${chainUpper}`);
  }
  
  console.log(`[SyncState] PAUSED ${chainUpper}: ${reason}`);
  return state;
}

/**
 * Resume chain ingestion
 */
export async function resumeChain(chain: string): Promise<IChainSyncStateDocument> {
  const chainUpper = chain.toUpperCase();
  
  const state = await ChainSyncStateModel.findOneAndUpdate(
    { chain: chainUpper },
    {
      $set: {
        status: 'OK',
        pauseReason: undefined,
        consecutiveErrors: 0,
        updatedAt: new Date()
      }
    },
    { new: true }
  );
  
  if (!state) {
    throw new Error(`Chain state not found: ${chainUpper}`);
  }
  
  console.log(`[SyncState] RESUMED ${chainUpper}`);
  return state;
}

/**
 * Reset chain state (dangerous - use with caution)
 */
export async function resetChain(
  chain: string,
  newStartBlock: number
): Promise<IChainSyncStateDocument> {
  const chainUpper = chain.toUpperCase();
  
  const state = await ChainSyncStateModel.findOneAndUpdate(
    { chain: chainUpper },
    {
      $set: {
        lastSyncedBlock: newStartBlock,
        status: 'OK',
        pauseReason: undefined,
        errorCount: 0,
        consecutiveErrors: 0,
        lastError: undefined,
        lastErrorAt: undefined,
        updatedAt: new Date()
      }
    },
    { new: true }
  );
  
  if (!state) {
    throw new Error(`Chain state not found: ${chainUpper}`);
  }
  
  console.log(`[SyncState] RESET ${chainUpper} to block ${newStartBlock}`);
  return state;
}

// ============================================
// Queries
// ============================================

/**
 * Get chains that need syncing (not paused, behind head)
 */
export async function getChainsNeedingSync(): Promise<IChainSyncStateDocument[]> {
  return ChainSyncStateModel.find({
    status: { $ne: 'PAUSED' },
    $expr: { $lt: ['$lastSyncedBlock', '$lastHeadBlock'] }
  }).lean();
}

/**
 * Get paused chains
 */
export async function getPausedChains(): Promise<IChainSyncStateDocument[]> {
  return ChainSyncStateModel.find({ status: 'PAUSED' }).lean();
}

/**
 * Get degraded/error chains
 */
export async function getUnhealthyChains(): Promise<IChainSyncStateDocument[]> {
  return ChainSyncStateModel.find({
    status: { $in: ['DEGRADED', 'ERROR'] }
  }).lean();
}

/**
 * Calculate lag for a chain
 */
export function calculateLag(state: IChainSyncState): number {
  return Math.max(0, state.lastHeadBlock - state.lastSyncedBlock);
}

/**
 * Get summary statistics
 */
export async function getSyncSummary(): Promise<{
  totalChains: number;
  activeChains: number;
  pausedChains: number;
  degradedChains: number;
  totalLag: number;
  totalEventsIngested: number;
}> {
  const states = await getAllChainStates();
  
  return {
    totalChains: states.length,
    activeChains: states.filter(s => s.status === 'OK').length,
    pausedChains: states.filter(s => s.status === 'PAUSED').length,
    degradedChains: states.filter(s => s.status === 'DEGRADED' || s.status === 'ERROR').length,
    totalLag: states.reduce((sum, s) => sum + calculateLag(s), 0),
    totalEventsIngested: states.reduce((sum, s) => sum + s.totalEventsIngested, 0)
  };
}

// ============================================
// Error Window Management
// ============================================

/**
 * Reset error count (called periodically to maintain rolling window)
 */
export async function resetErrorCounts(): Promise<void> {
  await ChainSyncStateModel.updateMany(
    { errorCount: { $gt: 0 } },
    { $set: { errorCount: 0 } }
  );
  console.log('[SyncState] Error counts reset for rolling window');
}
