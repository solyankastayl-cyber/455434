/**
 * Ingestion Orchestrator (P0.1)
 * 
 * Main controller for multi-chain ingestion.
 * Coordinates sync state, windows, budget, and replay guard.
 */

import * as SyncState from './chain_sync_state.service.js';
import * as BlockWindow from './block_window.service.js';
import * as RpcBudget from './rpc_budget_manager.js';
import * as ReplayGuard from './replay_guard.service.js';
import { SUPPORTED_CHAINS, IChainSyncState } from './chain_sync_state.model.js';

// ============================================
// Types
// ============================================

export interface IngestionResult {
  chain: string;
  fromBlock: number;
  toBlock: number;
  eventsFound: number;
  eventsIngested: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export type EventIngester = (
  chain: string,
  fromBlock: number,
  toBlock: number
) => Promise<{ eventsFound: number; eventsIngested: number }>;

export type HeadBlockFetcher = (chain: string) => Promise<number>;

// ============================================
// Configuration
// ============================================

const CONFIG = {
  MAX_CONCURRENT_CHAINS: 3,
  CYCLE_DELAY_MS: 1000,
  ERROR_COOLDOWN_MS: 5000
};

// ============================================
// Main Orchestration
// ============================================

/**
 * Process one chain - single window
 */
export async function processChain(
  chain: string,
  ingester: EventIngester,
  headFetcher: HeadBlockFetcher
): Promise<IngestionResult | null> {
  const chainUpper = chain.toUpperCase();
  const startTime = Date.now();
  
  // 1. Get current state
  let state = await SyncState.getChainState(chainUpper);
  if (!state) {
    state = await SyncState.initChain(chainUpper);
  }
  
  // 2. Check if paused
  if (state.status === 'PAUSED') {
    console.log(`[Orchestrator] ${chainUpper} is PAUSED: ${state.pauseReason}`);
    return null;
  }
  
  // 3. Get current head block
  let headBlock: number;
  try {
    headBlock = await headFetcher(chainUpper);
    await SyncState.updateHeadBlock(chainUpper, headBlock);
  } catch (error: any) {
    console.error(`[Orchestrator] Failed to get head block for ${chainUpper}:`, error.message);
    await SyncState.updateOnError(chainUpper, error);
    return {
      chain: chainUpper,
      fromBlock: 0,
      toBlock: 0,
      eventsFound: 0,
      eventsIngested: 0,
      durationMs: Date.now() - startTime,
      success: false,
      error: `Failed to get head block: ${error.message}`
    };
  }
  
  // 4. Calculate next window
  const window = BlockWindow.calculateNextWindow(state, headBlock);
  if (!window) {
    // Caught up
    return null;
  }
  
  // 5. Validate window
  const validation = BlockWindow.validateWindow(window, state);
  if (!validation.valid) {
    console.error(`[Orchestrator] Invalid window for ${chainUpper}: ${validation.error}`);
    return {
      chain: chainUpper,
      fromBlock: window.fromBlock,
      toBlock: window.toBlock,
      eventsFound: 0,
      eventsIngested: 0,
      durationMs: Date.now() - startTime,
      success: false,
      error: validation.error
    };
  }
  
  // 6. Check RPC budget
  const budget = RpcBudget.acquireSlot(chainUpper);
  if (!budget.canProceed) {
    console.log(`[Orchestrator] ${chainUpper} waiting for RPC budget: ${budget.reason}`);
    if (budget.waitMs > 0) {
      await RpcBudget.waitWithJitter(Math.min(budget.waitMs, 5000));
    }
    return null;
  }
  
  // 7. Begin replay guard
  const replay = await ReplayGuard.beginWindow(chainUpper, window.fromBlock, window.toBlock);
  if (!replay.canProcess) {
    console.log(`[Orchestrator] ${chainUpper} ${window.fromBlock}-${window.toBlock} already processed: ${replay.reason}`);
    RpcBudget.releaseSlot(chainUpper);
    return null;
  }
  
  // 8. Execute ingestion
  try {
    console.log(`[Orchestrator] Processing ${chainUpper} blocks ${window.fromBlock}-${window.toBlock} (${window.reason})`);
    
    const result = await ingester(chainUpper, window.fromBlock, window.toBlock);
    
    // 9. Success - update all trackers
    const durationMs = Date.now() - startTime;
    
    await Promise.all([
      SyncState.updateOnSuccess(chainUpper, window.fromBlock, window.toBlock, headBlock, {
        eventsIngested: result.eventsIngested,
        latencyMs: durationMs
      }),
      ReplayGuard.markDone(chainUpper, window.fromBlock, window.toBlock, result)
    ]);
    
    RpcBudget.onRpcSuccess(chainUpper);
    RpcBudget.releaseSlot(chainUpper);
    
    console.log(`[Orchestrator] ${chainUpper} ${window.fromBlock}-${window.toBlock} complete: ${result.eventsIngested} events in ${durationMs}ms`);
    
    return {
      chain: chainUpper,
      fromBlock: window.fromBlock,
      toBlock: window.toBlock,
      eventsFound: result.eventsFound,
      eventsIngested: result.eventsIngested,
      durationMs,
      success: true
    };
    
  } catch (error: any) {
    // 10. Error handling
    const durationMs = Date.now() - startTime;
    
    await Promise.all([
      SyncState.updateOnError(chainUpper, error),
      ReplayGuard.markFailed(chainUpper, window.fromBlock, window.toBlock, error.message)
    ]);
    
    RpcBudget.onRpcError(chainUpper, error);
    
    console.error(`[Orchestrator] ${chainUpper} ${window.fromBlock}-${window.toBlock} FAILED:`, error.message);
    
    return {
      chain: chainUpper,
      fromBlock: window.fromBlock,
      toBlock: window.toBlock,
      eventsFound: 0,
      eventsIngested: 0,
      durationMs,
      success: false,
      error: error.message
    };
  }
}

/**
 * Process all chains - one cycle
 */
export async function processAllChains(
  ingester: EventIngester,
  headFetcher: HeadBlockFetcher,
  chains?: string[]
): Promise<IngestionResult[]> {
  const targetChains = chains || SUPPORTED_CHAINS;
  const results: IngestionResult[] = [];
  
  // Process chains with concurrency limit
  const activeChains: Promise<IngestionResult | null>[] = [];
  
  for (const chain of targetChains) {
    // Wait if at concurrency limit
    if (activeChains.length >= CONFIG.MAX_CONCURRENT_CHAINS) {
      const completed = await Promise.race(activeChains);
      if (completed) results.push(completed);
      
      // Remove completed from active
      const index = activeChains.findIndex(p => p === completed);
      if (index > -1) activeChains.splice(index, 1);
    }
    
    // Start processing chain
    const promise = processChain(chain, ingester, headFetcher);
    activeChains.push(promise);
  }
  
  // Wait for remaining
  const remaining = await Promise.all(activeChains);
  for (const result of remaining) {
    if (result) results.push(result);
  }
  
  return results;
}

/**
 * Retry failed ranges
 */
export async function retryFailedRanges(
  ingester: EventIngester,
  limit: number = 5
): Promise<IngestionResult[]> {
  const failedRanges = await ReplayGuard.getFailedRangesForRetry(undefined, limit);
  const results: IngestionResult[] = [];
  
  for (const range of failedRanges) {
    const startTime = Date.now();
    
    // Check RPC budget
    const budget = RpcBudget.acquireSlot(range.chain);
    if (!budget.canProceed) {
      continue;
    }
    
    // Try to begin replay
    const replay = await ReplayGuard.beginWindow(range.chain, range.fromBlock, range.toBlock);
    if (!replay.canProcess) {
      RpcBudget.releaseSlot(range.chain);
      continue;
    }
    
    try {
      console.log(`[Orchestrator] Retrying ${range.chain} ${range.fromBlock}-${range.toBlock} (attempt ${range.retryCount + 1})`);
      
      const result = await ingester(range.chain, range.fromBlock, range.toBlock);
      
      await ReplayGuard.markDone(range.chain, range.fromBlock, range.toBlock, result);
      RpcBudget.onRpcSuccess(range.chain);
      RpcBudget.releaseSlot(range.chain);
      
      results.push({
        chain: range.chain,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        eventsFound: result.eventsFound,
        eventsIngested: result.eventsIngested,
        durationMs: Date.now() - startTime,
        success: true
      });
      
    } catch (error: any) {
      await ReplayGuard.markFailed(range.chain, range.fromBlock, range.toBlock, error.message);
      RpcBudget.onRpcError(range.chain, error);
      
      results.push({
        chain: range.chain,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        eventsFound: 0,
        eventsIngested: 0,
        durationMs: Date.now() - startTime,
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get overall ingestion status
 */
export async function getIngestionStatus(): Promise<{
  chains: Array<{
    chain: string;
    status: string;
    lastSyncedBlock: number;
    lastHeadBlock: number;
    lag: number;
    totalEvents: number;
  }>;
  summary: {
    totalChains: number;
    activeChains: number;
    pausedChains: number;
    totalLag: number;
    totalEvents: number;
  };
  replayStats: {
    done: number;
    inProgress: number;
    failed: number;
    failedRangesUnresolved: number;
  };
  rpcBudget: Array<ReturnType<typeof RpcBudget.getBudgetStatus>>;
}> {
  const [chainStates, syncSummary, replayStats, rpcBudget] = await Promise.all([
    SyncState.getAllChainStates(),
    SyncState.getSyncSummary(),
    ReplayGuard.getReplayStats(),
    Promise.resolve(RpcBudget.getAllBudgetStatus())
  ]);
  
  const chains = chainStates.map(state => ({
    chain: state.chain,
    status: state.status,
    lastSyncedBlock: state.lastSyncedBlock,
    lastHeadBlock: state.lastHeadBlock,
    lag: SyncState.calculateLag(state),
    totalEvents: state.totalEventsIngested
  }));
  
  return {
    chains,
    summary: {
      totalChains: syncSummary.totalChains,
      activeChains: syncSummary.activeChains,
      pausedChains: syncSummary.pausedChains,
      totalLag: syncSummary.totalLag,
      totalEvents: syncSummary.totalEventsIngested
    },
    replayStats: {
      done: replayStats.done,
      inProgress: replayStats.inProgress,
      failed: replayStats.failed,
      failedRangesUnresolved: replayStats.failedRangesUnresolved
    },
    rpcBudget
  };
}

/**
 * Initialize all chains for fresh start
 */
export async function initializeIngestion(
  startBlocks?: Record<string, number>
): Promise<void> {
  await SyncState.initAllChains(startBlocks);
  console.log('[Orchestrator] Ingestion initialized');
}
