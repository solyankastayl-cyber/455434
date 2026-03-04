/**
 * Trend Validation Worker
 * 
 * ETAP 3.2: Periodically validates trends for snapshots with outcomes.
 * 
 * Runs every 30 minutes when enabled.
 * Idempotent - same inputs always produce same outputs.
 * 
 * NO ML - NO side effects on Ranking/Engine.
 */
import { 
  validateBatch, 
  getValidationStats,
  getPendingValidation,
} from '../services/trend-validation.service.js';

// ==================== WORKER STATE ====================

interface WorkerState {
  running: boolean;
  intervalId: NodeJS.Timeout | null;
  lastRunAt: Date | null;
  lastResult: {
    processed: number;
    created: number;
    updated: number;
    errors: number;
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

// ==================== WORKER FUNCTIONS ====================

/**
 * Execute one validation cycle
 */
async function runCycle(): Promise<void> {
  if (!state.running) return;
  
  console.log('[TrendWorker] Running validation cycle...');
  
  try {
    const result = await validateBatch(BATCH_SIZE, true);
    
    state.lastRunAt = new Date();
    state.lastResult = {
      processed: result.processed,
      created: result.created,
      updated: result.updated,
      errors: result.errors,
    };
    state.totalRuns++;
    state.totalCreated += result.created;
    state.totalErrors += result.errors;
    
    console.log(`[TrendWorker] Cycle complete: +${result.created} validations, ${result.skipped} skipped, ${result.errors} errors`);
    
  } catch (error: any) {
    console.error('[TrendWorker] Cycle failed:', error);
    state.totalErrors++;
  }
}

/**
 * Start the trend validation worker
 */
export function startTrendWorker(): { success: boolean; message: string } {
  if (state.running) {
    return { success: false, message: 'Worker already running' };
  }
  
  console.log('[TrendWorker] Starting...');
  
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
 * Stop the trend validation worker
 */
export function stopTrendWorker(): { success: boolean; message: string } {
  if (!state.running) {
    return { success: false, message: 'Worker not running' };
  }
  
  console.log('[TrendWorker] Stopping...');
  
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
export async function getTrendWorkerStatus(): Promise<{
  running: boolean;
  lastRunAt: Date | null;
  lastResult: WorkerState['lastResult'];
  totalRuns: number;
  totalCreated: number;
  totalErrors: number;
  intervalMs: number;
  pendingCount: number;
  stats: Awaited<ReturnType<typeof getValidationStats>>;
}> {
  const [pending, stats] = await Promise.all([
    getPendingValidation(1000).then(p => p.length),
    getValidationStats(),
  ]);
  
  return {
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    totalRuns: state.totalRuns,
    totalCreated: state.totalCreated,
    totalErrors: state.totalErrors,
    intervalMs: INTERVAL_MS,
    pendingCount: pending,
    stats,
  };
}

/**
 * Run a single cycle manually
 */
export async function runTrendWorkerOnce(): Promise<{
  success: boolean;
  result: Awaited<ReturnType<typeof validateBatch>> | null;
  error?: string;
}> {
  console.log('[TrendWorker] Manual run triggered');
  
  try {
    const result = await validateBatch(BATCH_SIZE, true);
    
    state.lastRunAt = new Date();
    state.lastResult = {
      processed: result.processed,
      created: result.created,
      updated: result.updated,
      errors: result.errors,
    };
    state.totalRuns++;
    state.totalCreated += result.created;
    state.totalErrors += result.errors;
    
    return { success: true, result };
    
  } catch (error: any) {
    console.error('[TrendWorker] Manual run failed:', error);
    return { success: false, result: null, error: error.message };
  }
}
