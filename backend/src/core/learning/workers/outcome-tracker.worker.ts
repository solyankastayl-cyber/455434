/**
 * Outcome Tracker Worker
 * 
 * ETAP 3.1: Periodically checks for matured snapshots and tracks outcomes.
 * 
 * Runs every 15 minutes when enabled.
 * Can be started/stopped via API.
 */
import { runOutcomeTrackingCycle, getOutcomeStats } from '../services/outcome-tracker.service.js';

// ==================== WORKER STATE ====================

interface WorkerState {
  running: boolean;
  intervalId: NodeJS.Timeout | null;
  lastRunAt: Date | null;
  lastResult: {
    processed: number;
    updated: number;
    errors: number;
  } | null;
  totalRuns: number;
  totalUpdated: number;
  totalErrors: number;
}

const state: WorkerState = {
  running: false,
  intervalId: null,
  lastRunAt: null,
  lastResult: null,
  totalRuns: 0,
  totalUpdated: 0,
  totalErrors: 0,
};

// Configuration
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const BATCH_SIZE = 50;

// ==================== WORKER FUNCTIONS ====================

/**
 * Execute one tracking cycle
 */
async function runCycle(): Promise<void> {
  if (!state.running) return;
  
  console.log('[OutcomeWorker] Running cycle...');
  
  try {
    const result = await runOutcomeTrackingCycle(BATCH_SIZE);
    
    state.lastRunAt = new Date();
    state.lastResult = {
      processed: result.processed,
      updated: result.updated,
      errors: result.errors,
    };
    state.totalRuns++;
    state.totalUpdated += result.updated;
    state.totalErrors += result.errors;
    
    console.log(`[OutcomeWorker] Cycle complete: +${result.updated} outcomes tracked`);
    
  } catch (error: any) {
    console.error('[OutcomeWorker] Cycle failed:', error);
    state.totalErrors++;
  }
}

/**
 * Start the outcome tracking worker
 */
export function startOutcomeWorker(): { success: boolean; message: string } {
  if (state.running) {
    return { success: false, message: 'Worker already running' };
  }
  
  console.log('[OutcomeWorker] Starting...');
  
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
 * Stop the outcome tracking worker
 */
export function stopOutcomeWorker(): { success: boolean; message: string } {
  if (!state.running) {
    return { success: false, message: 'Worker not running' };
  }
  
  console.log('[OutcomeWorker] Stopping...');
  
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
export async function getOutcomeWorkerStatus(): Promise<{
  running: boolean;
  lastRunAt: Date | null;
  lastResult: WorkerState['lastResult'];
  totalRuns: number;
  totalUpdated: number;
  totalErrors: number;
  intervalMs: number;
  outcomeStats: Awaited<ReturnType<typeof getOutcomeStats>>;
}> {
  const outcomeStats = await getOutcomeStats();
  
  return {
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    totalRuns: state.totalRuns,
    totalUpdated: state.totalUpdated,
    totalErrors: state.totalErrors,
    intervalMs: INTERVAL_MS,
    outcomeStats,
  };
}

/**
 * Run a single cycle manually
 */
export async function runOutcomeWorkerOnce(): Promise<{
  success: boolean;
  result: Awaited<ReturnType<typeof runOutcomeTrackingCycle>> | null;
  error?: string;
}> {
  console.log('[OutcomeWorker] Manual run triggered');
  
  try {
    const result = await runOutcomeTrackingCycle(BATCH_SIZE);
    
    state.lastRunAt = new Date();
    state.lastResult = {
      processed: result.processed,
      updated: result.updated,
      errors: result.errors,
    };
    state.totalRuns++;
    state.totalUpdated += result.updated;
    state.totalErrors += result.errors;
    
    return { success: true, result };
    
  } catch (error: any) {
    console.error('[OutcomeWorker] Manual run failed:', error);
    return { success: false, result: null, error: error.message };
  }
}
