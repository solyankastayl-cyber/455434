/**
 * Approval Worker
 * 
 * Scheduled job for processing aggregates through Approval Gate.
 * Runs every 10 minutes.
 * 
 * Idempotent - can be restarted safely.
 */
import { processAll, type ApprovalProcessResult } from '../services/approval-gate.service.js';

// ==================== STATE ====================

let isRunning = false;
let workerInterval: ReturnType<typeof setInterval> | null = null;
let lastRunAt: Date | null = null;
let lastRunDurationMs = 0;
let lastRunResults: ApprovalProcessResult[] = [];
let totalRuns = 0;

const APPROVAL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// ==================== WORKER CONTROL ====================

/**
 * Start the approval worker
 */
export function startApprovalWorker(): { ok: boolean; message: string } {
  if (isRunning) {
    return { ok: false, message: 'Approval worker already running' };
  }
  
  isRunning = true;
  
  console.log('[Approval Worker] Starting (10 min interval)...');
  
  // Run first cycle immediately
  runApprovalCycle();
  
  // Start interval
  workerInterval = setInterval(() => {
    runApprovalCycle();
  }, APPROVAL_INTERVAL_MS);
  
  return { ok: true, message: 'Approval worker started' };
}

/**
 * Stop the approval worker
 */
export function stopApprovalWorker(): { ok: boolean; message: string } {
  if (!isRunning) {
    return { ok: false, message: 'Approval worker not running' };
  }
  
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  
  isRunning = false;
  console.log('[Approval Worker] Stopped');
  
  return { ok: true, message: 'Approval worker stopped' };
}

/**
 * Run a single approval cycle
 */
async function runApprovalCycle(): Promise<void> {
  const cycleStart = Date.now();
  
  try {
    const result = await processAll();
    
    lastRunAt = new Date();
    lastRunDurationMs = result.durationMs;
    lastRunResults = result.results;
    totalRuns++;
    
    // Log only if something was processed
    if (result.totals.processed > 0) {
      console.log(
        `[Approval Worker] Cycle #${totalRuns}: ` +
        `+${result.totals.approved} approved, ` +
        `${result.totals.quarantined} quarantined, ` +
        `${result.totals.rejected} rejected, ` +
        `${result.durationMs}ms`
      );
    }
    
  } catch (err: any) {
    console.error('[Approval Worker] Cycle error:', err.message);
  }
}

/**
 * Run approval manually (single run)
 */
export async function runApprovalOnce(): Promise<{
  ok: boolean;
  results: ApprovalProcessResult[];
  totals: {
    processed: number;
    approved: number;
    quarantined: number;
    rejected: number;
  };
  durationMs: number;
  error?: string;
}> {
  try {
    const result = await processAll();
    
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
      totals: { processed: 0, approved: 0, quarantined: 0, rejected: 0 },
      durationMs: 0,
      error: err.message,
    };
  }
}

/**
 * Get approval worker status
 */
export function getApprovalWorkerStatus(): {
  isRunning: boolean;
  totalRuns: number;
  lastRunAt: Date | null;
  lastRunDurationMs: number;
  lastRunResults: ApprovalProcessResult[];
  intervalMs: number;
} {
  return {
    isRunning,
    totalRuns,
    lastRunAt,
    lastRunDurationMs,
    lastRunResults,
    intervalMs: APPROVAL_INTERVAL_MS,
  };
}
