/**
 * Live Drift Worker
 * 
 * Scheduled job for computing drift summaries.
 * Runs every 10-15 minutes.
 * 
 * Idempotent - can be restarted safely.
 */
import { computeAllDrift, type DriftComputeResult } from '../services/liveDrift.service.js';

// ==================== STATE ====================

let isRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
let lastRunAt: Date | null = null;
let lastRunDurationMs = 0;
let lastRunResults: DriftComputeResult[] = [];
let totalRuns = 0;

const DRIFT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ==================== WORKER CONTROL ====================

/**
 * Start the drift worker
 */
export function startDriftWorker(): { ok: boolean; message: string } {
  if (isRunning) {
    return { ok: false, message: 'Drift worker already running' };
  }
  
  isRunning = true;
  
  console.log('[Drift Worker] Starting (15 min interval)...');
  
  // Run first cycle immediately
  runDriftCycle();
  
  // Start interval
  workerInterval = setInterval(() => {
    runDriftCycle();
  }, DRIFT_INTERVAL_MS);
  
  return { ok: true, message: 'Drift worker started' };
}

/**
 * Stop the drift worker
 */
export function stopDriftWorker(): { ok: boolean; message: string } {
  if (!isRunning) {
    return { ok: false, message: 'Drift worker not running' };
  }
  
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  
  isRunning = false;
  console.log('[Drift Worker] Stopped');
  
  return { ok: true, message: 'Drift worker stopped' };
}

/**
 * Run a single drift cycle
 */
async function runDriftCycle(): Promise<void> {
  const cycleStart = Date.now();
  
  try {
    const result = await computeAllDrift();
    
    lastRunAt = new Date();
    lastRunDurationMs = result.durationMs;
    lastRunResults = result.results;
    totalRuns++;
    
    // Log only if something was computed
    if (result.totals.computed > 0) {
      console.log(
        `[Drift Worker] Cycle #${totalRuns}: ` +
        `+${result.totals.computed} computed, ` +
        `${result.totals.skipped} skipped, ` +
        `${result.durationMs}ms`
      );
    }
    
  } catch (err: any) {
    console.error('[Drift Worker] Cycle error:', err.message);
  }
}

/**
 * Run drift manually (single run)
 */
export async function runDriftOnce(): Promise<{
  ok: boolean;
  results: DriftComputeResult[];
  totals: {
    computed: number;
    skipped: number;
  };
  durationMs: number;
  error?: string;
}> {
  try {
    const result = await computeAllDrift();
    
    lastRunAt = new Date();
    lastRunDurationMs = result.durationMs;
    lastRunResults = result.results;
    totalRuns++;
    
    return {
      ok: true,
      results: result.results,
      totals: result.totals,
      durationMs: result.durationMs,
    };
  } catch (err: any) {
    return {
      ok: false,
      results: [],
      totals: { computed: 0, skipped: 0 },
      durationMs: 0,
      error: err.message,
    };
  }
}

/**
 * Get drift worker status
 */
export function getDriftWorkerStatus(): {
  isRunning: boolean;
  totalRuns: number;
  lastRunAt: Date | null;
  lastRunDurationMs: number;
  lastRunResults: DriftComputeResult[];
  intervalMs: number;
} {
  return {
    isRunning,
    totalRuns,
    lastRunAt,
    lastRunDurationMs,
    lastRunResults,
    intervalMs: DRIFT_INTERVAL_MS,
  };
}
