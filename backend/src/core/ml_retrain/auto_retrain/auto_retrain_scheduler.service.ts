/**
 * ML v2.2: Auto-Retrain Scheduler
 * 
 * Периодически проверяет политики и запускает retrain при необходимости.
 * 
 * ВАЖНО: Scheduler стартует ТОЛЬКО если включён в admin settings.
 */

import { AutoRetrainPolicyService } from './auto_retrain_policy.service.js';

const NETWORKS = [
  'ethereum', 
  'arbitrum', 
  'optimism', 
  'base', 
  'polygon', 
  'bsc', 
  'avalanche', 
  'fantom'
];

const TASKS: Array<'market' | 'actor'> = ['market', 'actor'];

// Check interval: 60 seconds
const TICK_INTERVAL_MS = 60_000;

let schedulerTimer: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Start the auto-retrain scheduler
 */
export function startAutoRetrainScheduler(): void {
  if (schedulerTimer) {
    console.log('[v2.2] Auto-retrain scheduler already running');
    return;
  }

  console.log('[v2.2] Starting auto-retrain scheduler (60s interval)');
  
  schedulerTimer = setInterval(async () => {
    if (isRunning) {
      console.log('[v2.2] Previous tick still running, skipping');
      return;
    }
    
    isRunning = true;
    
    try {
      await tick();
    } catch (err) {
      console.error('[v2.2] Scheduler tick error:', err);
    } finally {
      isRunning = false;
    }
  }, TICK_INTERVAL_MS);

  // Run first tick immediately (after short delay)
  setTimeout(() => {
    tick().catch(err => {
      console.error('[v2.2] Initial tick error:', err);
    });
  }, 5000);
}

/**
 * Stop the auto-retrain scheduler
 */
export function stopAutoRetrainScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[v2.2] Auto-retrain scheduler stopped');
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerTimer !== null;
}

/**
 * Single scheduler tick - evaluate all policies
 */
async function tick(): Promise<void> {
  let enqueuedCount = 0;
  let skippedCount = 0;

  for (const network of NETWORKS) {
    for (const task of TASKS) {
      try {
        const result = await AutoRetrainPolicyService.evaluateAndEnqueue(task, network);
        
        if (result.enqueued) {
          enqueuedCount++;
        } else {
          skippedCount++;
        }
      } catch (err) {
        console.error(`[v2.2] Evaluation error for ${task}/${network}:`, err);
      }
    }
  }

  if (enqueuedCount > 0) {
    console.log(`[v2.2] Tick complete: ${enqueuedCount} enqueued, ${skippedCount} skipped`);
  }
}

/**
 * Manual trigger for a specific task/network
 */
export async function triggerEvaluation(
  task: 'market' | 'actor', 
  network: string
) {
  return AutoRetrainPolicyService.evaluateAndEnqueue(task, network);
}
