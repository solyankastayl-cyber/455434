/**
 * Retrain Scheduler
 * 
 * ETAP 5.1: Scheduled retraining orchestration.
 * 
 * Key principles:
 * - Retrain only through scheduler (no direct train calls)
 * - All retrains go through guard checks
 * - Scheduler is isolated from Ranking/Engine
 */
import { SelfLearningRuntimeModel } from './self_learning.runtime.model.js';
import { canRetrain, formatGuardResult } from './retrain.guard.js';
import type { Horizon, RetrainWorkerResult } from './self_learning.types.js';
import { SELF_LEARNING_CONSTANTS } from './self_learning.types.js';

// ==================== SCHEDULER STATE ====================

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;
let lastRunResult: RetrainWorkerResult | null = null;

// ==================== SCHEDULER CONFIG ====================

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ==================== SCHEDULER FUNCTIONS ====================

/**
 * Start the scheduler
 */
export async function startScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): Promise<{
  success: boolean;
  message: string;
}> {
  if (schedulerInterval) {
    return { success: false, message: 'Scheduler already running' };
  }
  
  const config = await SelfLearningRuntimeModel.getConfig();
  
  if (!config.enabled) {
    return { success: false, message: 'Self-learning is disabled' };
  }
  
  if (!config.scheduleEnabled) {
    return { success: false, message: 'Scheduler is disabled in config' };
  }
  
  console.log(`[RetrainScheduler] Starting with interval ${intervalMs}ms`);
  
  // Run immediately on start
  runScheduledRetrain().catch(console.error);
  
  // Set up interval
  schedulerInterval = setInterval(() => {
    runScheduledRetrain().catch(console.error);
  }, intervalMs);
  
  return { success: true, message: `Scheduler started with ${intervalMs}ms interval` };
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): { success: boolean; message: string } {
  if (!schedulerInterval) {
    return { success: false, message: 'Scheduler not running' };
  }
  
  clearInterval(schedulerInterval);
  schedulerInterval = null;
  
  console.log('[RetrainScheduler] Stopped');
  
  return { success: true, message: 'Scheduler stopped' };
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  running: boolean;
  isProcessing: boolean;
  lastRunResult: RetrainWorkerResult | null;
} {
  return {
    running: schedulerInterval !== null,
    isProcessing: isRunning,
    lastRunResult,
  };
}

// ==================== RETRAIN EXECUTION ====================

/**
 * Run scheduled retrain for all horizons
 */
async function runScheduledRetrain(): Promise<void> {
  if (isRunning) {
    console.log('[RetrainScheduler] Skipping - already running');
    return;
  }
  
  isRunning = true;
  console.log('[RetrainScheduler] Starting scheduled retrain check');
  
  try {
    const config = await SelfLearningRuntimeModel.getConfig();
    
    if (!config.enabled) {
      console.log('[RetrainScheduler] Self-learning disabled, skipping');
      return;
    }
    
    // Process each horizon
    for (const horizon of config.horizons) {
      const result = await executeRetrainForHorizon(horizon as Horizon);
      lastRunResult = result;
      
      if (result.success) {
        console.log(`[RetrainScheduler] ${horizon}: ${result.gateDecision || 'N/A'}`);
      } else {
        console.log(`[RetrainScheduler] ${horizon}: Skipped - ${result.error || 'guard denied'}`);
      }
    }
    
  } catch (error: any) {
    console.error('[RetrainScheduler] Error:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Execute retrain for a single horizon
 * 
 * This is the main orchestration function:
 * 1. Check guard
 * 2. Freeze dataset
 * 3. Train model
 * 4. Evaluate
 * 5. Gate decision
 */
export async function executeRetrainForHorizon(horizon: Horizon): Promise<RetrainWorkerResult> {
  const startedAt = new Date();
  
  // Step 1: Guard check
  const guardResult = await canRetrain(horizon);
  
  if (guardResult.decision === 'DENY') {
    console.log(`[RetrainScheduler] Guard DENIED for ${horizon}:`);
    console.log(formatGuardResult(guardResult));
    
    return {
      success: false,
      horizon,
      guardResult,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      error: `Guard denied: ${guardResult.blockedBy.join(', ')}`,
    };
  }
  
  console.log(`[RetrainScheduler] Guard ALLOWED for ${horizon}`);
  
  try {
    // Step 2: Freeze dataset
    const { freezeDataset } = await import('./dataset_freezer.service.js');
    const freezeResult = await freezeDataset({ horizon, createdBy: 'scheduler' });
    
    if (!freezeResult.success || !freezeResult.datasetVersion) {
      return {
        success: false,
        horizon,
        guardResult,
        startedAt,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        error: `Dataset freeze failed: ${freezeResult.message}`,
      };
    }
    
    console.log(`[RetrainScheduler] Dataset frozen: ${freezeResult.datasetVersion}`);
    
    // Step 3: Train model
    const { trainModelVersioned } = await import('./model_trainer.service.js');
    const trainResult = await trainModelVersioned({
      horizon,
      datasetVersion: freezeResult.datasetVersion,
    });
    
    if (!trainResult.success || !trainResult.modelVersion) {
      return {
        success: false,
        horizon,
        guardResult,
        datasetVersion: freezeResult.datasetVersion,
        startedAt,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        error: `Training failed: ${trainResult.message}`,
      };
    }
    
    console.log(`[RetrainScheduler] Model trained: ${trainResult.modelVersion}`);
    
    // Step 4: Evaluate (will be implemented in PR #2)
    // For now, just record the result
    
    // Step 5: Record result
    await SelfLearningRuntimeModel.recordRetrainResult(
      horizon,
      'HOLD', // Gate decision (HOLD until evaluation implemented)
      trainResult.modelVersion
    );
    
    return {
      success: true,
      horizon,
      guardResult,
      datasetVersion: freezeResult.datasetVersion,
      modelVersion: trainResult.modelVersion,
      gateDecision: 'HOLD',
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    };
    
  } catch (error: any) {
    console.error(`[RetrainScheduler] Error for ${horizon}:`, error);
    
    return {
      success: false,
      horizon,
      guardResult,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      error: error.message,
    };
  }
}

/**
 * Manual trigger (with guard check)
 */
export async function triggerManualRetrain(horizon: Horizon): Promise<RetrainWorkerResult> {
  const config = await SelfLearningRuntimeModel.getConfig();
  
  if (!config.enabled) {
    return {
      success: false,
      horizon,
      guardResult: {
        decision: 'DENY',
        checks: {} as any,
        blockedBy: ['disabled'],
        checkedAt: new Date(),
      },
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
      error: 'Self-learning is disabled',
    };
  }
  
  return executeRetrainForHorizon(horizon);
}
