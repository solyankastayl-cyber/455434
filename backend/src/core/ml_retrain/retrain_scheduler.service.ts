/**
 * Retrain Scheduler Service
 * 
 * BATCH 1: Периодически проверяет очередь на новые задачи.
 * Можно вынести в worker позже — сейчас достаточно.
 */

import { RetrainExecutorService } from './retrain_executor.service.js';

let schedulerInterval: NodeJS.Timeout | null = null;
const SCHEDULER_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Start the retrain scheduler
 */
export function startRetrainScheduler(): void {
  if (schedulerInterval) {
    console.log('[RetrainScheduler] Already running');
    return;
  }

  console.log(`[RetrainScheduler] Starting (interval: ${SCHEDULER_INTERVAL_MS}ms)`);
  
  schedulerInterval = setInterval(async () => {
    try {
      await RetrainExecutorService.runNext();
    } catch (err) {
      console.error('[RetrainScheduler] Error:', err);
    }
  }, SCHEDULER_INTERVAL_MS);

  // Run once immediately
  RetrainExecutorService.runNext().catch(err => {
    console.error('[RetrainScheduler] Initial run error:', err);
  });
}

/**
 * Stop the retrain scheduler
 */
export function stopRetrainScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[RetrainScheduler] Stopped');
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}
