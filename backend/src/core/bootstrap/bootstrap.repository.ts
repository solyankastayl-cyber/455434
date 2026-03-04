/**
 * Bootstrap Tasks Repository (P2.1 Step 1)
 * 
 * Database operations for bootstrap tasks.
 * Handles idempotency, status transitions, and queries.
 */
import { 
  BootstrapTaskModel, 
  IBootstrapTask, 
  BootstrapSubjectType, 
  BootstrapStatus,
  BootstrapChain,
  generateDedupKey,
  calculateBackoffDelay,
} from './bootstrap_tasks.model.js';
import { emitStatsUpdate } from './bootstrap.stats.js';

export interface EnqueueInput {
  subjectType: BootstrapSubjectType;
  chain: BootstrapChain;
  address?: string;
  subjectId?: string;
  tokenAddress?: string;
  priority?: number;
}

export interface EnqueueResult {
  queued: boolean;
  taskId?: string;
  existing?: boolean;
  status?: BootstrapStatus;
}

/**
 * Find existing active task by dedup key
 */
export async function findActiveTask(dedupKey: string): Promise<IBootstrapTask | null> {
  return BootstrapTaskModel.findOne({
    dedupKey,
    status: { $in: ['queued', 'running'] },
  }).lean();
}

/**
 * Find task by dedup key (any status)
 */
export async function findByDedupKey(dedupKey: string): Promise<IBootstrapTask | null> {
  return BootstrapTaskModel.findOne({ dedupKey }).lean();
}

/**
 * Create new bootstrap task (idempotent)
 * 
 * Rules:
 * - If queued/running exists → return existing, don't create
 * - If failed exists → can create new (different _id)
 * - If done exists → don't create
 */
export async function enqueue(input: EnqueueInput): Promise<EnqueueResult> {
  const dedupKey = generateDedupKey(
    input.subjectType,
    input.chain,
    input.address,
    input.subjectId,
    input.tokenAddress
  );

  // Check for existing active task
  const existing = await findByDedupKey(dedupKey);
  
  if (existing) {
    // Already queued or running → don't create new
    if (existing.status === 'queued' || existing.status === 'running') {
      return {
        queued: false,
        existing: true,
        taskId: existing._id.toString(),
        status: existing.status,
      };
    }
    
    // Already done → don't re-index
    if (existing.status === 'done') {
      return {
        queued: false,
        existing: true,
        taskId: existing._id.toString(),
        status: 'done',
      };
    }
    
    // Failed → can retry, delete old and create new
    if (existing.status === 'failed') {
      await BootstrapTaskModel.deleteOne({ _id: existing._id });
    }
  }

  // Create new task
  const task = await BootstrapTaskModel.create({
    subjectType: input.subjectType,
    chain: input.chain,
    address: input.address?.toLowerCase(),
    subjectId: input.subjectId?.toLowerCase(),
    tokenAddress: input.tokenAddress?.toLowerCase(),
    dedupKey,
    status: 'queued',
    priority: input.priority || 3,
    attempts: 0,
    maxAttempts: 5,
    progress: 0,
  });

  // Emit stats update when task enqueued (P2.3.B)
  emitStatsUpdate();

  return {
    queued: true,
    taskId: task._id.toString(),
    status: 'queued',
  };
}

/**
 * Get next task for worker (atomic claim)
 */
export async function claimNextTask(): Promise<IBootstrapTask | null> {
  const now = new Date();
  
  // Find and atomically update to 'running'
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
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { priority: 1, createdAt: 1 }, // Lower priority number = higher priority
      new: true,
    }
  );

  return task;
}

/**
 * Mark task as done
 */
export async function markDone(taskId: string): Promise<void> {
  await BootstrapTaskModel.updateOne(
    { _id: taskId },
    {
      $set: {
        status: 'done',
        progress: 100,
        finishedAt: new Date(),
      },
    }
  );
}

/**
 * Mark task as failed (with retry logic)
 */
export async function markFailed(taskId: string, error: string): Promise<{ willRetry: boolean }> {
  const task = await BootstrapTaskModel.findById(taskId);
  if (!task) return { willRetry: false };

  const willRetry = task.attempts < task.maxAttempts;

  if (willRetry) {
    // Schedule retry with backoff
    const delay = calculateBackoffDelay(task.attempts);
    const nextRetryAt = new Date(Date.now() + delay);

    await BootstrapTaskModel.updateOne(
      { _id: taskId },
      {
        $set: {
          status: 'queued', // Back to queue for retry
          lastError: error,
          nextRetryAt,
        },
      }
    );
  } else {
    // Max attempts exceeded → permanent failure
    await BootstrapTaskModel.updateOne(
      { _id: taskId },
      {
        $set: {
          status: 'failed',
          lastError: error,
          finishedAt: new Date(),
        },
      }
    );
  }

  return { willRetry };
}

/**
 * Update task progress
 */
export async function updateProgress(
  taskId: string, 
  progress: number, 
  step?: string
): Promise<void> {
  await BootstrapTaskModel.updateOne(
    { _id: taskId },
    {
      $set: {
        progress: Math.min(100, Math.max(0, progress)),
        ...(step && { step }),
      },
    }
  );
}

/**
 * Get task status for a subject (with ETA calculation)
 */
export async function getTaskStatus(
  subjectType: BootstrapSubjectType,
  chain: string,
  identifier: string
): Promise<{
  exists: boolean;
  status?: BootstrapStatus;
  progress?: number;
  step?: string;
  etaSeconds?: number | null;
  attempts?: number;
  updatedAt?: Date;
  dedupKey?: string;
}> {
  const dedupKey = generateDedupKey(subjectType, chain, identifier);
  const task = await findByDedupKey(dedupKey);

  if (!task) {
    return { exists: false };
  }

  // Calculate ETA based on progress and step timing
  let etaSeconds: number | null = null;
  if (task.status === 'queued' || task.status === 'running') {
    etaSeconds = calculateETA(task.subjectType, task.progress);
  }

  return {
    exists: true,
    status: task.status,
    progress: task.progress,
    step: task.step,
    etaSeconds,
    attempts: task.attempts,
    updatedAt: task.updatedAt,
    dedupKey,
  };
}

/**
 * Get task status by dedupKey directly
 */
export async function getTaskStatusByDedupKey(dedupKey: string): Promise<{
  exists: boolean;
  status?: BootstrapStatus;
  progress?: number;
  step?: string;
  etaSeconds?: number | null;
  attempts?: number;
  updatedAt?: Date;
}> {
  const task = await findByDedupKey(dedupKey);

  if (!task) {
    return { exists: false };
  }

  let etaSeconds: number | null = null;
  if (task.status === 'queued' || task.status === 'running') {
    etaSeconds = calculateETA(task.subjectType, task.progress);
  }

  return {
    exists: true,
    status: task.status,
    progress: task.progress,
    step: task.step,
    etaSeconds,
    attempts: task.attempts,
    updatedAt: task.updatedAt,
  };
}

/**
 * Calculate ETA in seconds based on subject type and progress
 * Uses average step duration estimates
 */
function calculateETA(subjectType: BootstrapSubjectType, progress: number): number | null {
  // Average total time per subject type (in seconds)
  const avgTotalTime: Record<BootstrapSubjectType, number> = {
    wallet: 30,
    actor: 45,
    entity: 60,
    token: 25,
  };

  const totalTime = avgTotalTime[subjectType] || 30;
  const remainingPercent = 100 - progress;
  
  if (remainingPercent <= 0) return 0;
  
  return Math.ceil((totalTime * remainingPercent) / 100);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  queued: number;
  running: number;
  done: number;
  failed: number;
  total: number;
}> {
  const [stats] = await BootstrapTaskModel.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  const result = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    total: 0,
  };

  const rawStats = await BootstrapTaskModel.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  for (const stat of rawStats) {
    result[stat._id as BootstrapStatus] = stat.count;
    result.total += stat.count;
  }

  return result;
}
