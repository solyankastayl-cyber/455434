/**
 * Live Aggregation Worker
 * 
 * Scheduled job for computing time-window aggregates.
 * Runs every 5 minutes to process closed windows.
 * 
 * Sequential processing, MAX_CONCURRENCY = 1
 */

import {
  aggregateAll,
  getAggregationStats,
  type AggregationResult,
} from '../services/live_aggregation.service.js';
import { isIngestionEnabled } from '../live_ingestion.service.js';

// ==================== STATE ====================

let isRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
let lastRunAt: Date | null = null;
let lastRunDurationMs = 0;
let lastRunResults: AggregationResult[] = [];
let totalRuns = 0;

const AGGREGATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ==================== WORKER CONTROL ====================

/**
 * Start the aggregation worker
 */
export function startAggregationWorker(): { ok: boolean; message: string } {
  if (isRunning) {
    return { ok: false, message: 'Aggregation worker already running' };
  }
  
  isRunning = true;
  
  console.log('[Aggregation Worker] Starting...');
  
  // Run first cycle immediately
  runAggregationCycle();
  
  // Start interval
  workerInterval = setInterval(() => {
    runAggregationCycle();
  }, AGGREGATION_INTERVAL_MS);
  
  return { ok: true, message: 'Aggregation worker started (5 min interval)' };
}

/**
 * Stop the aggregation worker
 */
export function stopAggregationWorker(): { ok: boolean; message: string } {
  if (!isRunning) {
    return { ok: false, message: 'Aggregation worker not running' };
  }
  
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  
  isRunning = false;
  console.log('[Aggregation Worker] Stopped');
  
  return { ok: true, message: 'Aggregation worker stopped' };
}

/**
 * Run a single aggregation cycle
 */
async function runAggregationCycle(): Promise<void> {
  const cycleStart = Date.now();
  
  try {
    const result = await aggregateAll();
    
    lastRunAt = new Date();
    lastRunDurationMs = result.durationMs;
    lastRunResults = result.results;
    totalRuns++;
    
    // Log only if something was created
    if (result.totalWindowsCreated > 0) {
      console.log(`[Aggregation Worker] Cycle #${totalRuns}: +${result.totalWindowsCreated} windows, ${result.totalEventsProcessed} events, ${result.durationMs}ms`);
    }
    
  } catch (err: any) {
    console.error('[Aggregation Worker] Cycle error:', err.message);
  }
}

/**
 * Run aggregation manually (single run)
 */
export async function runAggregationOnce(): Promise<{
  ok: boolean;
  results: AggregationResult[];
  totalWindowsCreated: number;
  totalEventsProcessed: number;
  durationMs: number;
  error?: string;
}> {
  try {
    const result = await aggregateAll();
    
    lastRunAt = new Date();
    lastRunDurationMs = result.durationMs;
    lastRunResults = result.results;
    totalRuns++;
    
    return {
      ok: true,
      results: result.results,
      totalWindowsCreated: result.totalWindowsCreated,
      totalEventsProcessed: result.totalEventsProcessed,
      durationMs: result.durationMs,
    };
  } catch (err: any) {
    return {
      ok: false,
      results: [],
      totalWindowsCreated: 0,
      totalEventsProcessed: 0,
      durationMs: 0,
      error: err.message,
    };
  }
}

/**
 * Get aggregation worker status
 */
export function getAggregationWorkerStatus(): {
  isRunning: boolean;
  totalRuns: number;
  lastRunAt: Date | null;
  lastRunDurationMs: number;
  lastRunResults: AggregationResult[];
  intervalMs: number;
} {
  return {
    isRunning,
    totalRuns,
    lastRunAt,
    lastRunDurationMs,
    lastRunResults,
    intervalMs: AGGREGATION_INTERVAL_MS,
  };
}
