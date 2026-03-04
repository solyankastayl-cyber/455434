/**
 * Bootstrap Worker (P2.1 Step 2 + P2.3 WebSocket Events + B1 Failure Classification)
 * 
 * Orchestrator for indexing tasks.
 * - Claims tasks atomically
 * - Runs indexers sequentially
 * - Tracks progress
 * - Handles retry/timeout
 * - Emits events to EventBus (P2.3)
 * - Classifies failures (B1)
 * 
 * Worker does NOT:
 * - Decide what to index (that's Resolver's job)
 * - Implement business logic
 * - Touch UI
 */
import { BootstrapTaskModel, IBootstrapTask, BootstrapSubjectType, calculateBackoffDelay, generateDedupKey, classifyFailureReason } from './bootstrap_tasks.model.js';
import * as indexerService from './indexer.service.js';
import { eventBus } from '../websocket/event-bus.js';
import { emitStatsUpdate } from './bootstrap.stats.js';
import * as os from 'os';

// Configuration
const WORKER_INTERVAL = 10_000; // 10 seconds
const TASK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const RECOVERY_INTERVAL = 2 * 60 * 1000; // 2 minutes
const HEARTBEAT_INTERVAL = 10_000; // 10 seconds
const LOCK_TTL_SEC = 120; // 2 minutes

// Worker state
let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let recoveryTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

// B2: Import lock and heartbeat
import { acquireLock, refreshLock, releaseLock } from '../system/lock.model.js';
import { updateHeartbeat } from '../system/heartbeat.model.js';

const WORKER_KEY = 'bootstrap_worker';

/**
 * B2: Send heartbeat to indicate worker is alive
 */
async function sendHeartbeat(): Promise<void> {
  try {
    await updateHeartbeat(WORKER_KEY, {
      pid: process.pid,
      host: os.hostname(),
    });
    
    // Also refresh lock
    await refreshLock(WORKER_KEY);
  } catch (err) {
    console.error('[BOOTSTRAP] Failed to send heartbeat:', err);
  }
}

/**
 * Start the bootstrap worker
 */
export async function start(): Promise<boolean> {
  if (isRunning) {
    console.log('[BOOTSTRAP] Worker already running');
    return false;
  }
  
  // B2: Try to acquire lock (single worker enforcement)
  const gotLock = await acquireLock(WORKER_KEY, LOCK_TTL_SEC);
  if (!gotLock) {
    console.warn('[BOOTSTRAP] Worker lock held by another process, not starting');
    return false;
  }
  
  isRunning = true;
  console.log('[BOOTSTRAP] Worker started (lock acquired)');
  
  // Start polling loop
  pollTimer = setInterval(poll, WORKER_INTERVAL);
  
  // Start recovery job
  recoveryTimer = setInterval(recoverStaleTasks, RECOVERY_INTERVAL);
  
  // B2: Start heartbeat
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  sendHeartbeat(); // Send immediately
  
  // Run poll immediately
  poll();
  
  return true;
}

/**
 * Stop the bootstrap worker
 */
export async function stop(): Promise<void> {
  isRunning = false;
  
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
  
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  
  // B2: Release lock
  try {
    await releaseLock(WORKER_KEY);
    console.log('[BOOTSTRAP] Worker stopped (lock released)');
  } catch (err) {
    console.error('[BOOTSTRAP] Failed to release lock:', err);
  }
}

/**
 * Main polling function
 */
async function poll(): Promise<void> {
  if (!isRunning) return;
  
  try {
    const task = await claimNextTask();
    if (!task) return; // No tasks available
    
    console.log(`[BOOTSTRAP] Claimed task ${task._id} (${task.subjectType}:${task.address || task.subjectId})`);
    
    try {
      await processTask(task);
      await markDone(task._id.toString());
      console.log(`[BOOTSTRAP] Task ${task._id} completed successfully`);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[BOOTSTRAP] Task ${task._id} failed: ${error}`);
      await handleFailure(task._id.toString(), error);
    }
  } catch (err) {
    console.error('[BOOTSTRAP] Poll error:', err);
  }
}

/**
 * Atomically claim next available task
 */
async function claimNextTask(): Promise<IBootstrapTask | null> {
  const now = new Date();
  
  const task = await BootstrapTaskModel.findOneAndUpdate(
    {
      status: 'queued',
      $or: [
        { nextRetryAt: { $exists: false } },
        { nextRetryAt: { $lte: now } },
      ],
    },
    {
      $set: {
        status: 'running',
        startedAt: now,
        updatedAt: now,
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { priority: 1, createdAt: 1 }, // Lower priority number = higher priority
      new: true,
    }
  );
  
  // Emit stats update when task claimed (P2.3.B)
  if (task) {
    emitStatsUpdate();
  }
  
  return task;
}

/**
 * Process a bootstrap task by running indexers sequentially
 */
async function processTask(task: IBootstrapTask): Promise<void> {
  const { subjectType, chain, address, subjectId, tokenAddress } = task;
  const taskId = task._id.toString();
  const dedupKey = task.dedupKey;
  
  // Get steps for this subject type
  const steps = getStepsForSubjectType(subjectType);
  const totalSteps = steps.length;
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const progress = Math.round(((i + 1) / totalSteps) * 100);
    const eta = Math.ceil(((totalSteps - i - 1) * 5)); // ~5 seconds per step
    
    // Update progress before running step
    await updateProgress(taskId, progress - 10, step);
    
    // Emit progress event (P2.3)
    eventBus.emitEvent({
      type: 'bootstrap.progress',
      dedupKey,
      progress: progress - 10,
      step: formatStepName(step),
      eta,
    });
    
    console.log(`[BOOTSTRAP] Task ${taskId}: Running step ${step} (${i + 1}/${totalSteps})`);
    
    // Run the indexer step
    await indexerService.runStep(step, {
      subjectType,
      chain,
      address,
      subjectId,
      tokenAddress,
    });
    
    // Update progress after step completes
    await updateProgress(taskId, progress, step);
  }
  
  // Emit done event (P2.3)
  eventBus.emitEvent({
    type: 'bootstrap.done',
    dedupKey,
  });
}

/**
 * Format step name for display
 */
function formatStepName(step: string): string {
  const names: Record<string, string> = {
    'erc20_indexer': 'Scanning transactions',
    'build_transfers': 'Building transfers',
    'build_relations': 'Analyzing relationships',
    'build_bundles': 'Grouping activity',
    'build_signals': 'Generating signals',
    'build_scores': 'Calculating scores',
    'build_strategy_profiles': 'Classifying strategies',
    'token_metadata': 'Fetching token info',
    'erc20_indexer_by_token': 'Scanning token transfers',
    'market_metrics': 'Loading market data',
    'token_signals': 'Analyzing token activity',
  };
  return names[step] || step;
}

/**
 * Get indexing steps for a subject type
 */
function getStepsForSubjectType(subjectType: BootstrapSubjectType): string[] {
  switch (subjectType) {
    case 'wallet':
    case 'actor':
    case 'entity':
      // EVM address indexing pipeline
      return [
        'erc20_indexer',
        'build_transfers',
        'build_relations',
        'build_bundles',
        'build_signals',
        'build_scores',
        'build_strategy_profiles',
      ];
    
    case 'token':
      // Token indexing pipeline
      return [
        'token_metadata',
        'erc20_indexer_by_token',
        'market_metrics',
        'token_signals',
      ];
    
    default:
      return ['basic_indexer'];
  }
}

/**
 * Update task progress
 */
async function updateProgress(taskId: string, progress: number, step: string): Promise<void> {
  await BootstrapTaskModel.updateOne(
    { _id: taskId },
    {
      $set: {
        progress: Math.min(100, Math.max(0, progress)),
        step,
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Mark task as done
 */
async function markDone(taskId: string): Promise<void> {
  const task = await BootstrapTaskModel.findById(taskId);
  
  await BootstrapTaskModel.updateOne(
    { _id: taskId },
    {
      $set: {
        status: 'done',
        progress: 100,
        finishedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
  
  // P0 FIX: Update resolver cache to 'completed' status
  if (task?.address) {
    try {
      const { updateResolutionAfterBootstrap } = await import('../resolver/resolver.service.js');
      await updateResolutionAfterBootstrap(task.address, 'done');
    } catch (err) {
      console.error('[BOOTSTRAP] Failed to update resolution after completion:', err);
    }
  }
  
  // Emit stats update when task done (P2.3.B)
  emitStatsUpdate();
}

/**
 * Handle task failure with retry logic (B1: with failure classification)
 */
async function handleFailure(taskId: string, error: string): Promise<void> {
  const task = await BootstrapTaskModel.findById(taskId);
  if (!task) return;
  
  // B1: Classify the failure reason
  const failureReason = classifyFailureReason(error);
  const failureDetails = error.slice(0, 200); // Truncate for storage
  
  const willRetry = task.attempts < task.maxAttempts;
  
  if (willRetry) {
    // Schedule retry with exponential backoff
    const delay = calculateBackoffDelay(task.attempts);
    const nextRetryAt = new Date(Date.now() + delay);
    
    await BootstrapTaskModel.updateOne(
      { _id: taskId },
      {
        $set: {
          status: 'queued',
          lastError: error,
          failureReason,
          failureDetails,
          lastErrorAt: new Date(),
          nextRetryAt,
          updatedAt: new Date(),
        },
      }
    );
    
    console.warn(`[BOOTSTRAP] Task ${taskId} retry scheduled in ${Math.round(delay / 1000)}s (attempt ${task.attempts}/${task.maxAttempts}, reason: ${failureReason})`);
    
    // Emit stats update for retry (P2.3.B)
    emitStatsUpdate();
  } else {
    // Max attempts exceeded → permanent failure
    await BootstrapTaskModel.updateOne(
      { _id: taskId },
      {
        $set: {
          status: 'failed',
          lastError: error,
          failureReason,
          failureDetails,
          lastErrorAt: new Date(),
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    
    console.error(`[BOOTSTRAP] Task ${taskId} failed permanently after ${task.maxAttempts} attempts (reason: ${failureReason})`);
    
    // P0 FIX: Update resolver cache to 'failed' status
    if (task.address) {
      try {
        const { updateResolutionAfterBootstrap } = await import('../resolver/resolver.service.js');
        await updateResolutionAfterBootstrap(task.address, 'failed');
      } catch (err) {
        console.error('[BOOTSTRAP] Failed to update resolution after failure:', err);
      }
    }
    
    // Emit failed event (P2.3)
    eventBus.emitEvent({
      type: 'bootstrap.failed',
      dedupKey: task.dedupKey,
      error,
      failureReason,
    });
    
    // Emit stats update for failure (P2.3.B)
    emitStatsUpdate();
  }
}

/**
 * Recovery job: Reset stale running tasks
 * Protects against process crashes, hung RPC, unclean exits
 */
async function recoverStaleTasks(): Promise<void> {
  const timeoutThreshold = new Date(Date.now() - TASK_TIMEOUT_MS);
  
  const result = await BootstrapTaskModel.updateMany(
    {
      status: 'running',
      startedAt: { $lt: timeoutThreshold },
    },
    [
      {
        $set: {
          status: 'queued',
          lastError: 'Worker timeout - task exceeded 15 minute limit',
          nextRetryAt: {
            $add: [
              new Date(),
              { $multiply: [{ $pow: [2, '$attempts'] }, 60000] }, // backoff in ms
            ],
          },
          updatedAt: new Date(),
        },
      },
    ]
  );
  
  if (result.modifiedCount > 0) {
    console.warn(`[BOOTSTRAP] Recovered ${result.modifiedCount} stale task(s)`);
  }
}

/**
 * Get worker status
 */
export function getStatus(): { running: boolean; interval: number; timeout: number } {
  return {
    running: isRunning,
    interval: WORKER_INTERVAL,
    timeout: TASK_TIMEOUT_MS,
  };
}
