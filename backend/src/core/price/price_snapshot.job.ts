/**
 * P0.2a Price Snapshot Job
 * 
 * Batch job to refresh prices for token universe.
 * Runs on schedule (default: every 60 seconds).
 * 
 * Features:
 * - Only screens enabled tokens from universe
 * - Respects rate limits via ProviderPool
 * - Writes to price_snapshot collection
 * - Reports statistics
 */

import { getEnabledTokens, initializeCoreTokens } from './token_universe.model.js';
import { refreshPrice, PriceSnapshotModel } from './price.service.js';
import { getProviderPool } from '../providers/provider_pool.service.js';

// ============================================
// CONFIG
// ============================================

const SNAPSHOT_INTERVAL_MS = 60 * 1000; // 60 seconds
const BATCH_SIZE = 10; // Process tokens in batches
const BATCH_DELAY_MS = 1000; // Delay between batches

// ============================================
// JOB STATE
// ============================================

let isRunning = false;
let lastRunAt: Date | null = null;
let lastStats: SnapshotStats | null = null;

interface SnapshotStats {
  startedAt: Date;
  completedAt: Date;
  tokensProcessed: number;
  pricesUpdated: number;
  pricesFailed: number;
  durationMs: number;
}

// ============================================
// JOB LOGIC
// ============================================

/**
 * Run price snapshot job
 */
export async function runPriceSnapshotJob(): Promise<SnapshotStats> {
  if (isRunning) {
    console.log('[PriceSnapshotJob] Already running, skipping');
    return lastStats!;
  }
  
  isRunning = true;
  const startedAt = new Date();
  let tokensProcessed = 0;
  let pricesUpdated = 0;
  let pricesFailed = 0;
  
  try {
    // Initialize core tokens if not exist
    await initializeCoreTokens();
    
    // Get enabled tokens
    const tokens = await getEnabledTokens(500);
    console.log(`[PriceSnapshotJob] Processing ${tokens.length} tokens`);
    
    // Process in batches to respect rate limits
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      
      // Check if any provider is available
      const pool = getProviderPool();
      const provider = pool.getAvailableProvider();
      
      if (!provider) {
        console.log('[PriceSnapshotJob] No providers available, pausing');
        await delay(5000); // Wait 5 seconds
        continue;
      }
      
      // Process batch
      const results = await Promise.allSettled(
        batch.map((token) => refreshPrice(token.symbol, token.network))
      );
      
      for (const result of results) {
        tokensProcessed++;
        if (result.status === 'fulfilled' && result.value) {
          pricesUpdated++;
        } else {
          pricesFailed++;
        }
      }
      
      // Delay between batches
      if (i + BATCH_SIZE < tokens.length) {
        await delay(BATCH_DELAY_MS);
      }
    }
    
    const completedAt = new Date();
    const stats: SnapshotStats = {
      startedAt,
      completedAt,
      tokensProcessed,
      pricesUpdated,
      pricesFailed,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
    
    lastStats = stats;
    lastRunAt = completedAt;
    
    console.log(
      `[PriceSnapshotJob] Completed: ${pricesUpdated}/${tokensProcessed} prices updated in ${stats.durationMs}ms`
    );
    
    return stats;
  } catch (err) {
    console.error('[PriceSnapshotJob] Error:', err);
    throw err;
  } finally {
    isRunning = false;
  }
}

/**
 * Get job status
 */
export function getJobStatus(): {
  isRunning: boolean;
  lastRunAt: Date | null;
  lastStats: SnapshotStats | null;
  providerStatus: any[];
} {
  return {
    isRunning,
    lastRunAt,
    lastStats,
    providerStatus: getProviderPool().getStatus(),
  };
}

/**
 * Get snapshot stats from DB
 */
export async function getSnapshotStats(): Promise<{
  totalSnapshots: number;
  uniqueAssets: number;
  lastSnapshotAt: Date | null;
  oldestSnapshotAt: Date | null;
}> {
  const [count, uniqueAssets, latest, oldest] = await Promise.all([
    PriceSnapshotModel.countDocuments(),
    PriceSnapshotModel.distinct('asset').then((r) => r.length),
    PriceSnapshotModel.findOne().sort({ ts: -1 }).lean(),
    PriceSnapshotModel.findOne().sort({ ts: 1 }).lean(),
  ]);
  
  return {
    totalSnapshots: count,
    uniqueAssets,
    lastSnapshotAt: latest?.fetchedAt || null,
    oldestSnapshotAt: oldest?.fetchedAt || null,
  };
}

// ============================================
// SCHEDULER
// ============================================

let intervalId: NodeJS.Timeout | null = null;

/**
 * Start scheduled job
 */
export function startScheduler(intervalMs: number = SNAPSHOT_INTERVAL_MS): void {
  if (intervalId) {
    console.log('[PriceSnapshotJob] Scheduler already running');
    return;
  }
  
  console.log(`[PriceSnapshotJob] Starting scheduler (interval: ${intervalMs}ms)`);
  
  // Run immediately
  runPriceSnapshotJob().catch(console.error);
  
  // Schedule recurring
  intervalId = setInterval(() => {
    runPriceSnapshotJob().catch(console.error);
  }, intervalMs);
}

/**
 * Stop scheduler
 */
export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[PriceSnapshotJob] Scheduler stopped');
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return intervalId !== null;
}

// ============================================
// HELPERS
// ============================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default {
  runPriceSnapshotJob,
  getJobStatus,
  getSnapshotStats,
  startScheduler,
  stopScheduler,
  isSchedulerRunning,
};
