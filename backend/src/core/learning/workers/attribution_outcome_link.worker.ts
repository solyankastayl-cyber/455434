/**
 * Attribution Outcome Link Worker
 * 
 * ETAP 3.3: Periodically builds links for snapshots with validated trends.
 * 
 * Runs every 30 minutes when enabled.
 * Processes all horizons: 1d, 7d, 30d (1d first).
 * Idempotent - same inputs always produce same outputs.
 * 
 * NO ML - NO side effects on Ranking/Engine.
 */
import { 
  buildLinksForPendingSnapshots, 
  getLinkStats,
  getPendingForLinking,
} from '../services/attribution_outcome_link.service.js';
import type { Horizon } from '../learning.types.js';

// ==================== WORKER STATE ====================

interface WorkerState {
  running: boolean;
  intervalId: NodeJS.Timeout | null;
  lastRunAt: Date | null;
  lastResult: {
    processed: number;
    created: number;
    errors: number;
    byHorizon: Record<string, { created: number; errors: number }>;
  } | null;
  totalRuns: number;
  totalCreated: number;
  totalErrors: number;
}

const state: WorkerState = {
  running: false,
  intervalId: null,
  lastRunAt: null,
  lastResult: null,
  totalRuns: 0,
  totalCreated: 0,
  totalErrors: 0,
};

// Configuration
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const BATCH_SIZE = 100;
const HORIZONS: Horizon[] = ['1d', '7d', '30d']; // 1d first (priority)

// ==================== WORKER FUNCTIONS ====================

/**
 * Execute one linking cycle for all horizons
 */
async function runCycle(): Promise<void> {
  if (!state.running) return;
  
  console.log('[AttributionWorker] Running linking cycle...');
  
  const cycleResult = {
    processed: 0,
    created: 0,
    errors: 0,
    byHorizon: {} as Record<string, { created: number; errors: number }>,
  };
  
  try {
    // Process each horizon in priority order
    for (const horizon of HORIZONS) {
      const result = await buildLinksForPendingSnapshots(horizon, BATCH_SIZE);
      
      cycleResult.processed += result.processed;
      cycleResult.created += result.created;
      cycleResult.errors += result.errors;
      cycleResult.byHorizon[horizon] = {
        created: result.created,
        errors: result.errors,
      };
      
      console.log(`[AttributionWorker] ${horizon}: +${result.created} links, ${result.skipped} skipped, ${result.errors} errors`);
    }
    
    state.lastRunAt = new Date();
    state.lastResult = cycleResult;
    state.totalRuns++;
    state.totalCreated += cycleResult.created;
    state.totalErrors += cycleResult.errors;
    
    console.log(`[AttributionWorker] Cycle complete: +${cycleResult.created} total links created`);
    
  } catch (error: any) {
    console.error('[AttributionWorker] Cycle failed:', error);
    state.totalErrors++;
  }
}

/**
 * Start the attribution linking worker
 */
export function startAttributionWorker(): { success: boolean; message: string } {
  if (state.running) {
    return { success: false, message: 'Worker already running' };
  }
  
  console.log('[AttributionWorker] Starting...');
  
  state.running = true;
  
  // Run immediately
  runCycle();
  
  // Schedule periodic runs
  state.intervalId = setInterval(() => {
    runCycle();
  }, INTERVAL_MS);
  
  return { success: true, message: 'Worker started' };
}

/**
 * Stop the attribution linking worker
 */
export function stopAttributionWorker(): { success: boolean; message: string } {
  if (!state.running) {
    return { success: false, message: 'Worker not running' };
  }
  
  console.log('[AttributionWorker] Stopping...');
  
  state.running = false;
  
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  
  return { success: true, message: 'Worker stopped' };
}

/**
 * Get worker status
 */
export async function getAttributionWorkerStatus(): Promise<{
  running: boolean;
  lastRunAt: Date | null;
  lastResult: WorkerState['lastResult'];
  totalRuns: number;
  totalCreated: number;
  totalErrors: number;
  intervalMs: number;
  pendingCounts: Record<string, number>;
  stats: Awaited<ReturnType<typeof getLinkStats>>;
}> {
  // Get pending counts per horizon
  const pendingCounts: Record<string, number> = {};
  for (const horizon of HORIZONS) {
    const pending = await getPendingForLinking(horizon, 1000);
    pendingCounts[horizon] = pending.length;
  }
  
  const stats = await getLinkStats();
  
  return {
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    totalRuns: state.totalRuns,
    totalCreated: state.totalCreated,
    totalErrors: state.totalErrors,
    intervalMs: INTERVAL_MS,
    pendingCounts,
    stats,
  };
}

/**
 * Run a single cycle manually for a specific horizon
 */
export async function runAttributionWorkerOnce(horizon?: Horizon): Promise<{
  success: boolean;
  result: Awaited<ReturnType<typeof buildLinksForPendingSnapshots>> | null;
  error?: string;
}> {
  const targetHorizon = horizon || '1d';
  console.log(`[AttributionWorker] Manual run triggered for ${targetHorizon}`);
  
  try {
    const result = await buildLinksForPendingSnapshots(targetHorizon, BATCH_SIZE);
    
    state.lastRunAt = new Date();
    state.totalRuns++;
    state.totalCreated += result.created;
    state.totalErrors += result.errors;
    
    return { success: true, result };
    
  } catch (error: any) {
    console.error('[AttributionWorker] Manual run failed:', error);
    return { success: false, result: null, error: error.message };
  }
}

/**
 * Run for all horizons manually
 */
export async function runAttributionWorkerAll(): Promise<{
  success: boolean;
  results: Record<string, Awaited<ReturnType<typeof buildLinksForPendingSnapshots>>>;
  totalCreated: number;
  totalErrors: number;
}> {
  console.log('[AttributionWorker] Manual run for ALL horizons triggered');
  
  const results: Record<string, Awaited<ReturnType<typeof buildLinksForPendingSnapshots>>> = {};
  let totalCreated = 0;
  let totalErrors = 0;
  
  try {
    for (const horizon of HORIZONS) {
      const result = await buildLinksForPendingSnapshots(horizon, BATCH_SIZE);
      results[horizon] = result;
      totalCreated += result.created;
      totalErrors += result.errors;
    }
    
    state.lastRunAt = new Date();
    state.totalRuns++;
    state.totalCreated += totalCreated;
    state.totalErrors += totalErrors;
    
    return { success: true, results, totalCreated, totalErrors };
    
  } catch (error: any) {
    console.error('[AttributionWorker] Manual all-run failed:', error);
    return { success: false, results, totalCreated, totalErrors };
  }
}
