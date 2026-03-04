/**
 * Live Ingestion Worker
 * 
 * Continuous tailing worker for on-chain data ingestion.
 * 
 * Features:
 * - Micro-backfill (6h) on first start
 * - Adaptive range slicing for high-volume tokens
 * - Provider failover (Infura → Ankr)
 * - Kill switch integration
 * - Deduplication via upsert
 */

import {
  CANARY_TOKENS,
  CHAIN_CONFIG,
  RANGE_CONFIG,
  RATE_CONFIG,
  TRANSFER_TOPIC,
  type CanaryToken,
} from '../live_ingestion.types.js';
import { LiveEventRawModel } from '../live_event_raw.model.js';
import { LiveIngestionCursorModel } from '../live_ingestion_cursor.model.js';
import {
  isIngestionEnabled,
  updateCycleMetrics,
  triggerKillSwitch,
  checkKillSwitchThresholds,
  getCursor,
  updateCursor,
} from '../live_ingestion.service.js';
import {
  getBlockNumber,
  getLogs,
  getBlock,
  getCurrentProviderName,
  getProviderStats,
} from '../providers/live_rpc_manager.js';

// ==================== STATE ====================

let isRunning = false;
let stopRequested = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;

// Cycle metrics
let cycleCount = 0;
let lastCycleAt: Date | null = null;
let lastCycleDurationMs = 0;

// ==================== WORKER CONTROL ====================

/**
 * Start the ingestion worker loop
 */
export async function startWorker(): Promise<{ ok: boolean; message: string }> {
  if (isRunning) {
    return { ok: false, message: 'Worker already running' };
  }
  
  const enabled = await isIngestionEnabled();
  if (!enabled) {
    return { ok: false, message: 'Ingestion is disabled. Use /api/live/toggle to enable.' };
  }
  
  isRunning = true;
  stopRequested = false;
  
  console.log('[Ingestion Worker] Starting...');
  
  // Run first cycle immediately
  await runCycle();
  
  // Start interval
  workerInterval = setInterval(async () => {
    if (stopRequested) {
      stopWorkerInternal();
      return;
    }
    
    await runCycle();
  }, RATE_CONFIG.POLLING_INTERVAL_MS);
  
  return { ok: true, message: 'Worker started' };
}

/**
 * Stop the ingestion worker
 */
export function stopWorker(): { ok: boolean; message: string } {
  if (!isRunning) {
    return { ok: false, message: 'Worker not running' };
  }
  
  stopRequested = true;
  console.log('[Ingestion Worker] Stop requested...');
  
  return { ok: true, message: 'Worker stop requested' };
}

/**
 * Internal stop
 */
function stopWorkerInternal(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  isRunning = false;
  stopRequested = false;
  console.log('[Ingestion Worker] Stopped');
}

/**
 * Get worker status
 */
export function getWorkerStatus(): {
  isRunning: boolean;
  cycleCount: number;
  lastCycleAt: Date | null;
  lastCycleDurationMs: number;
  providerStats: ReturnType<typeof getProviderStats>;
} {
  return {
    isRunning,
    cycleCount,
    lastCycleAt,
    lastCycleDurationMs,
    providerStats: getProviderStats(),
  };
}

// ==================== MAIN CYCLE ====================

/**
 * Run one ingestion cycle
 */
async function runCycle(): Promise<void> {
  const cycleStart = Date.now();
  
  try {
    // Check kill switch before each cycle
    const enabled = await isIngestionEnabled();
    if (!enabled) {
      console.log('[Ingestion Worker] Disabled by kill switch, stopping...');
      stopWorkerInternal();
      return;
    }
    
    // Check thresholds
    const thresholdCheck = await checkKillSwitchThresholds();
    if (thresholdCheck.shouldKill) {
      await triggerKillSwitch(thresholdCheck.reason!);
      stopWorkerInternal();
      return;
    }
    
    // Get current chain state
    const blockResult = await getBlockNumber();
    if (!blockResult.ok || !blockResult.blockNumber) {
      console.error('[Ingestion Worker] Failed to get block number:', blockResult.error);
      await updateCycleMetrics({ errors: 1, error: blockResult.error });
      return;
    }
    
    const headBlock = blockResult.blockNumber;
    const safeHead = headBlock - CHAIN_CONFIG.CONFIRMATIONS;
    
    // Process each token sequentially (v1: no parallelism)
    let totalInserted = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;
    
    for (const token of CANARY_TOKENS) {
      const result = await processToken(token, safeHead);
      totalInserted += result.inserted;
      totalDuplicates += result.duplicates;
      if (result.error) totalErrors++;
    }
    
    // Update metrics
    await updateCycleMetrics({
      eventsIngested: totalInserted,
      duplicates: totalDuplicates,
      errors: totalErrors > 0 ? totalErrors : undefined,
      lastBlock: safeHead,
      provider: getCurrentProviderName(),
    });
    
    cycleCount++;
    lastCycleAt = new Date();
    lastCycleDurationMs = Date.now() - cycleStart;
    
    console.log(`[Ingestion Worker] Cycle #${cycleCount} complete: +${totalInserted} events, ${totalDuplicates} dups, ${lastCycleDurationMs}ms`);
    
  } catch (err: any) {
    console.error('[Ingestion Worker] Cycle error:', err.message);
    await updateCycleMetrics({ errors: 1, error: err.message });
  }
}

// ==================== TOKEN PROCESSING ====================

/**
 * Process one token
 */
async function processToken(
  token: CanaryToken,
  safeHead: number
): Promise<{ inserted: number; duplicates: number; error?: string }> {
  try {
    // Get or initialize cursor
    let cursor = await getCursor(token.address);
    
    // Micro-backfill: If no cursor, start from 6h ago
    if (!cursor) {
      const backfillBlocks = CHAIN_CONFIG.MICRO_BACKFILL_HOURS * CHAIN_CONFIG.BLOCKS_PER_HOUR;
      const startBlock = safeHead - backfillBlocks;
      
      await updateCursor(token.address, startBlock, {
        mode: 'bootstrap',
        rangeHint: RANGE_CONFIG.RANGE_START,
        providerUsed: getCurrentProviderName(),
      });
      
      cursor = {
        lastProcessedBlock: startBlock,
        rangeHint: RANGE_CONFIG.RANGE_START,
        mode: 'bootstrap',
      };
      
      console.log(`[Ingestion Worker] ${token.symbol}: Initialized cursor at block ${startBlock} (${CHAIN_CONFIG.MICRO_BACKFILL_HOURS}h backfill)`);
    }
    
    // Calculate range with rewind for reorg safety
    const fromBlock = Math.max(cursor.lastProcessedBlock - CHAIN_CONFIG.REWIND, 0);
    const range = cursor.rangeHint || RANGE_CONFIG.RANGE_START;
    let toBlock = Math.min(fromBlock + range, safeHead);
    
    // Already up-to-date?
    if (fromBlock >= safeHead) {
      return { inserted: 0, duplicates: 0 };
    }
    
    // Fetch with adaptive range
    const fetchResult = await fetchLogsAdaptive(token, fromBlock, toBlock, range);
    
    if (!fetchResult.ok) {
      console.error(`[Ingestion Worker] ${token.symbol}: Fetch error - ${fetchResult.error}`);
      return { inserted: 0, duplicates: 0, error: fetchResult.error };
    }
    
    // Store events
    const storeResult = await storeEvents(token, fetchResult.logs!);
    
    // Update cursor
    const newMode = cursor.lastProcessedBlock < safeHead - 1000 ? 'bootstrap' : 'tail';
    await updateCursor(token.address, fetchResult.actualToBlock, {
      rangeHint: fetchResult.newRange,
      mode: newMode,
      providerUsed: getCurrentProviderName(),
    });
    
    return {
      inserted: storeResult.inserted,
      duplicates: storeResult.duplicates,
    };
    
  } catch (err: any) {
    console.error(`[Ingestion Worker] ${token.symbol}: Error - ${err.message}`);
    return { inserted: 0, duplicates: 0, error: err.message };
  }
}

// ==================== ADAPTIVE FETCH ====================

/**
 * Fetch logs with adaptive range reduction
 */
async function fetchLogsAdaptive(
  token: CanaryToken,
  fromBlock: number,
  toBlock: number,
  currentRange: number
): Promise<{
  ok: boolean;
  logs?: any[];
  actualToBlock: number;
  newRange: number;
  error?: string;
}> {
  let range = currentRange;
  let attempts = 0;
  const maxAttempts = 5;
  
  while (range >= RANGE_CONFIG.RANGE_MIN && attempts < maxAttempts) {
    attempts++;
    const adjustedToBlock = Math.min(fromBlock + range, toBlock);
    
    const result = await getLogs({
      address: token.address,
      fromBlock,
      toBlock: adjustedToBlock,
      topics: [TRANSFER_TOPIC],
    });
    
    if (result.ok && result.logs) {
      // Success - increase range for next cycle (slow growth)
      const newRange = Math.min(
        Math.floor(range * 1.1),
        RANGE_CONFIG.RANGE_MAX
      );
      
      return {
        ok: true,
        logs: result.logs,
        actualToBlock: adjustedToBlock,
        newRange,
      };
    }
    
    // Check if "too many results" error
    if (result.error && (
      result.error.includes('too many results') ||
      result.error.includes('query returned more than')
    )) {
      // Reduce range and retry
      range = Math.floor(range / 2);
      console.log(`[Ingestion Worker] ${token.symbol}: Reducing range to ${range}`);
      continue;
    }
    
    // Other error - return failure
    return {
      ok: false,
      actualToBlock: fromBlock,
      newRange: range,
      error: result.error,
    };
  }
  
  // Exhausted attempts
  return {
    ok: false,
    actualToBlock: fromBlock,
    newRange: Math.max(range, RANGE_CONFIG.RANGE_MIN),
    error: `Range too small after ${attempts} attempts`,
  };
}

// ==================== EVENT STORAGE ====================

/**
 * Store events with deduplication
 */
async function storeEvents(
  token: CanaryToken,
  logs: any[]
): Promise<{ inserted: number; duplicates: number }> {
  let inserted = 0;
  let duplicates = 0;
  
  // Batch operations for efficiency
  const bulkOps = [];
  
  for (const log of logs) {
    const blockNumber = parseInt(log.blockNumber, 16);
    const logIndex = parseInt(log.logIndex, 16);
    const from = '0x' + log.topics[1].slice(26);
    const to = '0x' + log.topics[2].slice(26);
    
    bulkOps.push({
      updateOne: {
        filter: {
          chainId: CHAIN_CONFIG.CHAIN_ID,
          tokenAddress: token.address.toLowerCase(),
          blockNumber,
          logIndex,
        },
        update: {
          $setOnInsert: {
            chainId: CHAIN_CONFIG.CHAIN_ID,
            tokenAddress: token.address.toLowerCase(),
            blockNumber,
            txHash: log.transactionHash.toLowerCase(),
            logIndex,
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            amount: log.data,
            timestamp: new Date(), // Will be updated if we fetch block timestamps
            tags: [],
            ingestedAt: new Date(),
          },
        },
        upsert: true,
      },
    });
  }
  
  if (bulkOps.length === 0) {
    return { inserted: 0, duplicates: 0 };
  }
  
  try {
    const result = await LiveEventRawModel.bulkWrite(bulkOps, { ordered: false });
    inserted = result.upsertedCount || 0;
    duplicates = bulkOps.length - inserted;
  } catch (err: any) {
    // Handle partial failures (some duplicates are OK)
    if (err.result) {
      inserted = err.result.nUpserted || 0;
      duplicates = bulkOps.length - inserted;
    } else {
      throw err;
    }
  }
  
  return { inserted, duplicates };
}

// ==================== MANUAL OPERATIONS ====================

/**
 * Run a single cycle manually (for testing)
 */
export async function runOneCycle(): Promise<{
  ok: boolean;
  summary: {
    tokensProcessed: number;
    totalInserted: number;
    totalDuplicates: number;
    durationMs: number;
    provider: string;
  };
  error?: string;
}> {
  const cycleStart = Date.now();
  
  try {
    const blockResult = await getBlockNumber();
    if (!blockResult.ok || !blockResult.blockNumber) {
      return {
        ok: false,
        summary: {
          tokensProcessed: 0,
          totalInserted: 0,
          totalDuplicates: 0,
          durationMs: Date.now() - cycleStart,
          provider: blockResult.provider,
        },
        error: blockResult.error,
      };
    }
    
    const safeHead = blockResult.blockNumber - CHAIN_CONFIG.CONFIRMATIONS;
    let totalInserted = 0;
    let totalDuplicates = 0;
    let tokensProcessed = 0;
    
    for (const token of CANARY_TOKENS) {
      const result = await processToken(token, safeHead);
      totalInserted += result.inserted;
      totalDuplicates += result.duplicates;
      tokensProcessed++;
    }
    
    // Update metrics
    await updateCycleMetrics({
      eventsIngested: totalInserted,
      duplicates: totalDuplicates,
      lastBlock: safeHead,
      provider: getCurrentProviderName(),
    });
    
    return {
      ok: true,
      summary: {
        tokensProcessed,
        totalInserted,
        totalDuplicates,
        durationMs: Date.now() - cycleStart,
        provider: getCurrentProviderName(),
      },
    };
    
  } catch (err: any) {
    return {
      ok: false,
      summary: {
        tokensProcessed: 0,
        totalInserted: 0,
        totalDuplicates: 0,
        durationMs: Date.now() - cycleStart,
        provider: getCurrentProviderName(),
      },
      error: err.message,
    };
  }
}

/**
 * Run micro-backfill for a specific token
 */
export async function runMicroBackfill(
  tokenSymbolOrAddress: string
): Promise<{
  ok: boolean;
  token: string;
  fromBlock: number;
  toBlock: number;
  inserted: number;
  duplicates: number;
  durationMs: number;
  error?: string;
}> {
  const startTime = Date.now();
  
  // Find token
  const token = CANARY_TOKENS.find(
    t => t.symbol.toLowerCase() === tokenSymbolOrAddress.toLowerCase() ||
         t.address.toLowerCase() === tokenSymbolOrAddress.toLowerCase()
  );
  
  if (!token) {
    return {
      ok: false,
      token: tokenSymbolOrAddress,
      fromBlock: 0,
      toBlock: 0,
      inserted: 0,
      duplicates: 0,
      durationMs: 0,
      error: 'Token not found in canary list',
    };
  }
  
  try {
    // Get current block
    const blockResult = await getBlockNumber();
    if (!blockResult.ok || !blockResult.blockNumber) {
      throw new Error(blockResult.error || 'Failed to get block number');
    }
    
    const safeHead = blockResult.blockNumber - CHAIN_CONFIG.CONFIRMATIONS;
    const backfillBlocks = CHAIN_CONFIG.MICRO_BACKFILL_HOURS * CHAIN_CONFIG.BLOCKS_PER_HOUR;
    const fromBlock = safeHead - backfillBlocks;
    
    // Reset cursor to force backfill
    await LiveIngestionCursorModel.deleteOne({
      chainId: CHAIN_CONFIG.CHAIN_ID,
      tokenAddress: token.address.toLowerCase(),
    });
    
    // Process token (will trigger backfill)
    let totalInserted = 0;
    let totalDuplicates = 0;
    let currentFrom = fromBlock;
    let range = RANGE_CONFIG.RANGE_START;
    
    while (currentFrom < safeHead) {
      const result = await fetchLogsAdaptive(token, currentFrom, safeHead, range);
      
      if (!result.ok) {
        throw new Error(result.error);
      }
      
      const storeResult = await storeEvents(token, result.logs!);
      totalInserted += storeResult.inserted;
      totalDuplicates += storeResult.duplicates;
      
      currentFrom = result.actualToBlock + 1;
      range = result.newRange;
    }
    
    // Update cursor
    await updateCursor(token.address, safeHead, {
      mode: 'tail',
      rangeHint: range,
      providerUsed: getCurrentProviderName(),
    });
    
    return {
      ok: true,
      token: token.symbol,
      fromBlock,
      toBlock: safeHead,
      inserted: totalInserted,
      duplicates: totalDuplicates,
      durationMs: Date.now() - startTime,
    };
    
  } catch (err: any) {
    return {
      ok: false,
      token: token.symbol,
      fromBlock: 0,
      toBlock: 0,
      inserted: 0,
      duplicates: 0,
      durationMs: Date.now() - startTime,
      error: err.message,
    };
  }
}
