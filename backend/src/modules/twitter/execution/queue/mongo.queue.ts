// P2: Mongo Task Queue - Persistent with Atomic Claim
// Replaces in-memory LiveTaskQueue

import { TwitterTaskModel, ITwitterTask, TaskStatus, TaskType, TaskPriority, PRIORITY_VALUES } from './task.model.js';
import { ParserTask, ParserTaskType } from '../types.js';
import { shouldRetry, RetryDecision, computeBackoff } from '../retry/index.js';
import { cooldownService, COOLDOWN_DURATIONS } from '../cooldown/index.js';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - unlock stale RUNNING tasks

export interface EnqueueOptions {
  priority?: TaskPriority;
  maxAttempts?: number;
  accountId?: string;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  result?: any;
  error?: string;
}

export class MongoTaskQueue {
  private workerId: string;

  constructor(workerId: string = 'worker_' + process.pid) {
    this.workerId = workerId;
  }

  /**
   * Add task to queue
   */
  async enqueue(
    type: TaskType,
    payload: Record<string, any>,
    options: EnqueueOptions = {}
  ): Promise<string> {
    const task = await TwitterTaskModel.create({
      type,
      payload,
      status: TaskStatus.PENDING,
      priority: options.priority || 'NORMAL',
      priorityValue: PRIORITY_VALUES[options.priority || 'NORMAL'],
      maxAttempts: options.maxAttempts || 3,
      accountId: options.accountId,
      attempts: 0,
    });

    console.log(`[MongoQueue] Enqueued task ${task._id} type=${type}`);
    return task._id.toString();
  }

  /**
   * Atomic claim: find and lock next available task
   * Returns null if no tasks available
   */
  async claim(): Promise<ITwitterTask | null> {
    const now = new Date();
    const lockExpiry = new Date(Date.now() - LOCK_TIMEOUT_MS);

    // Find and atomically update next available task
    const task = await TwitterTaskModel.findOneAndUpdate(
      {
        $and: [
          // Status check
          {
            $or: [
              { status: TaskStatus.PENDING },
              // Also claim stale RUNNING tasks (locked too long)
              { 
                status: TaskStatus.RUNNING, 
                lockedAt: { $lt: lockExpiry } 
              },
            ],
          },
          // Cooldown check
          {
            $or: [
              { cooldownUntil: { $exists: false } },
              { cooldownUntil: null },
              { cooldownUntil: { $lt: now } },
            ],
          },
          // Phase 4.1: Retry timing check
          {
            $or: [
              { nextRetryAt: { $exists: false } },
              { nextRetryAt: null },
              { nextRetryAt: { $lte: now } },
            ],
          },
        ],
      },
      {
        $set: {
          status: TaskStatus.RUNNING,
          lockedAt: now,
          lockedBy: this.workerId,
          startedAt: now,
        },
        $inc: {
          attempts: 1,
        },
      },
      {
        sort: {
          priorityValue: -1,  // HIGH priority first
          createdAt: 1,       // FIFO within same priority
        },
        new: true,
      }
    );

    if (task) {
      console.log(`[MongoQueue] Claimed task ${task._id} (attempt ${task.attempts}/${task.maxAttempts}, retry ${task.retryCount || 0})`);
    }

    return task;
  }

  /**
   * Mark task as successfully completed
   */
  async ack(taskId: string, result?: any): Promise<void> {
    await TwitterTaskModel.updateOne(
      { _id: taskId },
      {
        $set: {
          status: TaskStatus.DONE,
          completedAt: new Date(),
          result,
          lockedAt: null,
          lockedBy: null,
        },
      }
    );
    console.log(`[MongoQueue] Task ${taskId} completed`);
  }

  /**
   * Mark task as failed
   * Phase 4.1: Uses retry policy and exponential backoff
   * Phase 4.2: Triggers cooldown for rate limits
   */
  async fail(taskId: string, error: string, errorCode?: string, accountId?: string): Promise<void> {
    const task = await TwitterTaskModel.findById(taskId);
    if (!task) return;

    // Phase 4.1: Use centralized retry policy
    const decision = shouldRetry(errorCode);
    
    // Update error tracking
    task.lastError = error;
    task.lastErrorCode = errorCode || 'UNKNOWN';

    // Phase 4.2: Apply account cooldown for rate limits
    if (errorCode === 'RATE_LIMIT' || errorCode === 'RATE_LIMITED') {
      const accId = accountId || (task.payload as any)?.accountId;
      if (accId) {
        await cooldownService.applyAccountCooldown(
          accId,
          COOLDOWN_DURATIONS.RATE_LIMIT,
          'RATE_LIMIT'
        );
      }
    }

    if (decision === RetryDecision.NO_RETRY) {
      // Permanent failure - no retry
      await TwitterTaskModel.updateOne(
        { _id: taskId },
        {
          $set: {
            status: TaskStatus.FAILED,
            lastError: error,
            lastErrorCode: errorCode || 'UNKNOWN',
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
          },
        }
      );
      console.log(`[MongoQueue] Task ${taskId} FAILED (no-retry): ${errorCode}`);
      return;
    }

    if (decision === RetryDecision.COOLDOWN) {
      // Rate limited - longer cooldown
      const cooldownMs = COOLDOWN_DURATIONS.RATE_LIMIT;
      await TwitterTaskModel.updateOne(
        { _id: taskId },
        {
          $set: {
            status: TaskStatus.PENDING,
            lastError: error,
            lastErrorCode: errorCode || 'RATE_LIMIT',
            cooldownUntil: new Date(Date.now() + cooldownMs),
            nextRetryAt: new Date(Date.now() + cooldownMs),
            lockedAt: null,
            lockedBy: null,
          },
          $inc: { retryCount: 1 },
        }
      );
      console.log(`[MongoQueue] Task ${taskId} COOLDOWN (rate-limit): retry in ${cooldownMs / 1000}s`);
      return;
    }

    // RETRY with exponential backoff
    const currentRetryCount = task.retryCount || 0;
    const { delayMs, canRetry } = computeBackoff(currentRetryCount);

    if (!canRetry) {
      // Max attempts exceeded
      await TwitterTaskModel.updateOne(
        { _id: taskId },
        {
          $set: {
            status: TaskStatus.FAILED,
            lastError: error,
            lastErrorCode: errorCode || 'MAX_RETRIES',
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
          },
        }
      );
      console.log(`[MongoQueue] Task ${taskId} FAILED (max retries ${currentRetryCount}): ${errorCode}`);
      return;
    }

    // Schedule retry with backoff
    const nextRetryAt = new Date(Date.now() + delayMs);
    await TwitterTaskModel.updateOne(
      { _id: taskId },
      {
        $set: {
          status: TaskStatus.PENDING,
          lastError: error,
          lastErrorCode: errorCode || 'UNKNOWN',
          nextRetryAt,
          lockedAt: null,
          lockedBy: null,
        },
        $inc: { retryCount: 1 },
      }
    );
    console.log(`[Retry] task=${taskId} error=${errorCode} retry=${currentRetryCount + 1} next=${nextRetryAt.toISOString()}`);
  }

  /**
   * Get task by ID
   */
  async get(taskId: string): Promise<ITwitterTask | null> {
    return TwitterTaskModel.findById(taskId).lean();
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    total: number;
    pending: number;
    running: number;
    done: number;
    failed: number;
    inCooldown: number;
  }> {
    const now = new Date();
    
    const [stats] = await TwitterTaskModel.aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          pending: [{ $match: { status: TaskStatus.PENDING } }, { $count: 'count' }],
          running: [{ $match: { status: TaskStatus.RUNNING } }, { $count: 'count' }],
          done: [{ $match: { status: TaskStatus.DONE } }, { $count: 'count' }],
          failed: [{ $match: { status: TaskStatus.FAILED } }, { $count: 'count' }],
          inCooldown: [
            { 
              $match: { 
                status: TaskStatus.PENDING, 
                cooldownUntil: { $gt: now } 
              } 
            }, 
            { $count: 'count' }
          ],
        },
      },
    ]);

    return {
      total: stats.total[0]?.count || 0,
      pending: stats.pending[0]?.count || 0,
      running: stats.running[0]?.count || 0,
      done: stats.done[0]?.count || 0,
      failed: stats.failed[0]?.count || 0,
      inCooldown: stats.inCooldown[0]?.count || 0,
    };
  }

  /**
   * Get recent tasks for monitoring
   */
  async getRecent(limit: number = 50): Promise<ITwitterTask[]> {
    return TwitterTaskModel.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Cleanup old completed/failed tasks
   */
  async cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    
    const result = await TwitterTaskModel.deleteMany({
      status: { $in: [TaskStatus.DONE, TaskStatus.FAILED] },
      completedAt: { $lt: cutoff },
    });

    if (result.deletedCount > 0) {
      console.log(`[MongoQueue] Cleaned up ${result.deletedCount} old tasks`);
    }
    
    return result.deletedCount;
  }

  /**
   * Recover stale RUNNING tasks (orphaned due to worker crash)
   */
  async recoverStaleTasks(): Promise<number> {
    const lockExpiry = new Date(Date.now() - LOCK_TIMEOUT_MS);
    
    const result = await TwitterTaskModel.updateMany(
      {
        status: TaskStatus.RUNNING,
        lockedAt: { $lt: lockExpiry },
      },
      {
        $set: {
          status: TaskStatus.PENDING,
          lockedAt: null,
          lockedBy: null,
        },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`[MongoQueue] Recovered ${result.modifiedCount} stale tasks`);
    }
    
    return result.modifiedCount;
  }

  /**
   * Convert Mongo task to ParserTask format (for compatibility)
   */
  toParserTask(task: ITwitterTask): ParserTask {
    return {
      id: task._id.toString(),
      type: task.type as ParserTaskType,
      payload: task.payload,
      attempts: task.attempts,
      maxAttempts: task.maxAttempts,
      status: task.status as any,
      accountId: task.accountId,
      instanceId: task.instanceId,
      createdAt: task.createdAt.getTime(),
      startedAt: task.startedAt?.getTime(),
      completedAt: task.completedAt?.getTime(),
      lastError: task.lastError,
    };
  }

  /**
   * Calculate cooldown based on error type
   */
  private calculateCooldown(errorCode?: string): number {
    if (!errorCode) return 30 * 1000; // 30 seconds default
    
    switch (errorCode) {
      case 'RATE_LIMITED':
      case 'SLOT_RATE_LIMITED':
        return 10 * 60 * 1000; // 10 minutes for rate limit
      case 'PARSER_DOWN':
        return 2 * 60 * 1000;  // 2 minutes - wait for parser recovery
      case 'REMOTE_TIMEOUT':
        return 5 * 60 * 1000;  // 5 minutes for timeout
      case 'SLOT_IN_COOLDOWN':
        return 3 * 60 * 1000;  // 3 minutes
      case 'NO_AVAILABLE_SLOT':
        return 60 * 1000;      // 1 minute
      default:
        return 30 * 1000;      // 30 seconds
    }
  }
}

// Singleton instance
export const mongoTaskQueue = new MongoTaskQueue();
