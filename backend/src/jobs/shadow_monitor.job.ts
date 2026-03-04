/**
 * Shadow Monitor Job (ETAP 5.7)
 * 
 * Scheduled job that runs shadow monitoring for all active models.
 * Checks health and triggers auto-rollback if needed.
 * 
 * Schedule: Every 6 hours (configurable)
 */
import { runMonitor, getMonitorStatus } from '../core/self_learning/shadow_monitor.service.js';
import { logSelfLearningEvent } from '../core/self_learning/audit_helpers.js';

// ==================== CONSTANTS ====================

const JOB_NAME = 'ShadowMonitorJob';
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ==================== STATE ====================

let isRunning = false;
let intervalId: NodeJS.Timeout | null = null;
let lastRunAt: Date | null = null;
let lastResults: any = null;

// ==================== JOB LOGIC ====================

/**
 * Run monitor for both horizons
 */
export async function runShadowMonitorJob(): Promise<{
  success: boolean;
  results: {
    '7d': any;
    '30d': any;
  };
  duration: number;
}> {
  const start = Date.now();
  
  console.log(`[${JOB_NAME}] ========== STARTING ==========`);
  
  await logSelfLearningEvent({
    eventType: 'JOB_STARTED',
    details: { jobName: JOB_NAME },
    triggeredBy: 'scheduler',
    severity: 'info',
  });
  
  try {
    // Run monitor for both horizons in parallel
    const [result7d, result30d] = await Promise.all([
      runMonitor({ horizon: '7d', window: '7d' }),
      runMonitor({ horizon: '30d', window: '14d' }),
    ]);
    
    const duration = Date.now() - start;
    lastRunAt = new Date();
    lastResults = { '7d': result7d, '30d': result30d };
    
    console.log(`[${JOB_NAME}] ========== COMPLETED (${duration}ms) ==========`);
    console.log(`[${JOB_NAME}] 7d: ${result7d.decision || 'skipped'}, 30d: ${result30d.decision || 'skipped'}`);
    
    // Log completion
    await logSelfLearningEvent({
      eventType: 'JOB_COMPLETED',
      details: {
        jobName: JOB_NAME,
        duration,
        results: {
          '7d': {
            decision: result7d.decision,
            autoRollback: result7d.autoRollbackTriggered,
          },
          '30d': {
            decision: result30d.decision,
            autoRollback: result30d.autoRollbackTriggered,
          },
        },
      },
      triggeredBy: 'scheduler',
      severity: 'info',
    });
    
    return {
      success: true,
      results: { '7d': result7d, '30d': result30d },
      duration,
    };
    
  } catch (error: any) {
    console.error(`[${JOB_NAME}] Error:`, error);
    
    await logSelfLearningEvent({
      eventType: 'JOB_FAILED',
      details: {
        jobName: JOB_NAME,
        error: error.message,
      },
      triggeredBy: 'scheduler',
      severity: 'error',
    });
    
    return {
      success: false,
      results: { '7d': { error: error.message }, '30d': { error: error.message } },
      duration: Date.now() - start,
    };
  }
}

// ==================== WORKER CONTROL ====================

/**
 * Start the monitor worker
 */
export function startShadowMonitorWorker(): { success: boolean; message: string } {
  if (isRunning) {
    return { success: false, message: 'Shadow monitor worker already running' };
  }
  
  console.log(`[${JOB_NAME}] Starting worker (interval: ${RUN_INTERVAL_MS / 1000 / 60} minutes)`);
  
  isRunning = true;
  
  // Run immediately
  runShadowMonitorJob().catch(console.error);
  
  // Schedule periodic runs
  intervalId = setInterval(() => {
    runShadowMonitorJob().catch(console.error);
  }, RUN_INTERVAL_MS);
  
  return { success: true, message: `Shadow monitor worker started (every ${RUN_INTERVAL_MS / 1000 / 60 / 60} hours)` };
}

/**
 * Stop the monitor worker
 */
export function stopShadowMonitorWorker(): { success: boolean; message: string } {
  if (!isRunning) {
    return { success: false, message: 'Shadow monitor worker not running' };
  }
  
  console.log(`[${JOB_NAME}] Stopping worker`);
  
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  
  isRunning = false;
  
  return { success: true, message: 'Shadow monitor worker stopped' };
}

/**
 * Get worker status
 */
export function getShadowMonitorWorkerStatus() {
  return {
    jobName: JOB_NAME,
    isRunning,
    intervalMs: RUN_INTERVAL_MS,
    intervalHuman: `${RUN_INTERVAL_MS / 1000 / 60 / 60} hours`,
    lastRunAt,
    lastResults,
  };
}
