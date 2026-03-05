/**
 * Phase 7: Batch Simulation Storage
 */

import { getDb } from '../../../db/mongodb.js';
import {
  BatchRun,
  BatchTask,
  TaskStatus,
  RunStatus,
  BatchRunProgress,
} from './domain.js';

// ═══════════════════════════════════════════════════════════════
// COLLECTIONS
// ═══════════════════════════════════════════════════════════════

const RUNS_COLLECTION = 'ta_batch_runs';
const TASKS_COLLECTION = 'ta_batch_tasks';

async function runsCol() {
  const db = await getDb();
  return db.collection(RUNS_COLLECTION);
}

async function tasksCol() {
  const db = await getDb();
  return db.collection(TASKS_COLLECTION);
}

// ═══════════════════════════════════════════════════════════════
// RUNS
// ═══════════════════════════════════════════════════════════════

export async function insertRun(run: BatchRun): Promise<void> {
  const col = await runsCol();
  await col.insertOne(run);
}

export async function getRun(runId: string): Promise<BatchRun | null> {
  const col = await runsCol();
  return col.findOne({ runId }, { projection: { _id: 0 } }) as Promise<BatchRun | null>;
}

export async function listRuns(limit: number = 20): Promise<BatchRun[]> {
  const col = await runsCol();
  return col.find({}, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray() as Promise<BatchRun[]>;
}

export async function updateRunStatus(runId: string, status: RunStatus): Promise<void> {
  const col = await runsCol();
  const update: any = { status, updatedAt: Date.now() };
  
  if (status === 'RUNNING') update.startedAt = Date.now();
  if (status === 'DONE' || status === 'FAILED') update.completedAt = Date.now();
  
  await col.updateOne({ runId }, { $set: update });
}

export async function updateRunProgress(runId: string, progress: Partial<BatchRunProgress>): Promise<void> {
  const col = await runsCol();
  const update: any = { updatedAt: Date.now() };
  
  for (const [key, value] of Object.entries(progress)) {
    update[`progress.${key}`] = value;
  }
  
  await col.updateOne({ runId }, { $set: update });
}

// ═══════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════

export async function insertTasks(tasks: BatchTask[]): Promise<void> {
  if (tasks.length === 0) return;
  const col = await tasksCol();
  await col.insertMany(tasks);
}

export async function getTask(taskId: string): Promise<BatchTask | null> {
  const col = await tasksCol();
  return col.findOne({ taskId }, { projection: { _id: 0 } }) as Promise<BatchTask | null>;
}

export async function getTasksByRun(runId: string, status?: TaskStatus): Promise<BatchTask[]> {
  const col = await tasksCol();
  const filter: any = { runId };
  if (status) filter.status = status;
  
  return col.find(filter, { projection: { _id: 0 } })
    .sort({ createdAt: 1 })
    .toArray() as Promise<BatchTask[]>;
}

export async function claimNextTask(runId: string, workerId: string): Promise<BatchTask | null> {
  const col = await tasksCol();
  const now = Date.now();
  const leaseDuration = 10 * 60 * 1000; // 10 minutes
  
  // Find pending task or expired lease
  const result = await col.findOneAndUpdate(
    {
      runId,
      $or: [
        { status: 'PENDING' },
        { status: 'RUNNING', leaseUntil: { $lt: now } },
      ],
    },
    {
      $set: {
        status: 'RUNNING',
        leasedBy: workerId,
        leaseUntil: now + leaseDuration,
        startedAt: now,
        updatedAt: now,
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  
  return result as BatchTask | null;
}

export async function renewTaskLease(taskId: string, workerId: string): Promise<boolean> {
  const col = await tasksCol();
  const now = Date.now();
  const leaseDuration = 10 * 60 * 1000;
  
  const result = await col.updateOne(
    { taskId, leasedBy: workerId, status: 'RUNNING' },
    { $set: { leaseUntil: now + leaseDuration, updatedAt: now } }
  );
  
  return result.modifiedCount > 0;
}

export async function completeTask(
  taskId: string,
  success: boolean,
  stats?: { rowsWritten: number; tradesClosed: number },
  error?: string
): Promise<void> {
  const col = await tasksCol();
  const now = Date.now();
  
  const update: any = {
    status: success ? 'DONE' : 'FAILED',
    completedAt: now,
    updatedAt: now,
  };
  
  if (stats) {
    update.rowsWritten = stats.rowsWritten;
    update.tradesClosed = stats.tradesClosed;
  }
  
  if (error) {
    update.lastError = error;
  }
  
  await col.updateOne({ taskId }, { $set: update });
}

export async function getTaskStats(runId: string): Promise<{
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  rowsWritten: number;
  tradesClosed: number;
}> {
  const col = await tasksCol();
  
  const pipeline = [
    { $match: { runId } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        rows: { $sum: { $ifNull: ['$rowsWritten', 0] } },
        trades: { $sum: { $ifNull: ['$tradesClosed', 0] } },
      },
    },
  ];
  
  const results = await col.aggregate(pipeline).toArray();
  
  const stats = {
    total: 0,
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
    rowsWritten: 0,
    tradesClosed: 0,
  };
  
  for (const r of results) {
    const status = (r._id as string).toLowerCase();
    stats.total += r.count;
    
    if (status === 'pending') stats.pending = r.count;
    else if (status === 'running') stats.running = r.count;
    else if (status === 'done') {
      stats.done = r.count;
      stats.rowsWritten += r.rows;
      stats.tradesClosed += r.trades;
    }
    else if (status === 'failed') stats.failed = r.count;
  }
  
  return stats;
}

export async function requeueFailedTasks(runId: string): Promise<number> {
  const col = await tasksCol();
  
  const result = await col.updateMany(
    { runId, status: 'FAILED', attempts: { $lt: 5 } },
    {
      $set: {
        status: 'PENDING',
        updatedAt: Date.now(),
      },
      $unset: { leasedBy: '', leaseUntil: '' },
    }
  );
  
  return result.modifiedCount;
}

export async function releaseStuckTasks(runId: string): Promise<number> {
  const col = await tasksCol();
  const now = Date.now();
  
  const result = await col.updateMany(
    { runId, status: 'RUNNING', leaseUntil: { $lt: now } },
    {
      $set: {
        status: 'PENDING',
        updatedAt: now,
      },
      $unset: { leasedBy: '', leaseUntil: '' },
    }
  );
  
  return result.modifiedCount;
}

// ═══════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════

export async function ensureIndexes(): Promise<void> {
  const runs = await runsCol();
  const tasks = await tasksCol();
  
  await runs.createIndex({ runId: 1 }, { unique: true });
  await runs.createIndex({ status: 1, createdAt: -1 });
  
  await tasks.createIndex({ taskId: 1 }, { unique: true });
  await tasks.createIndex({ runId: 1, status: 1 });
  await tasks.createIndex({ runId: 1, leaseUntil: 1 });
  await tasks.createIndex({ symbol: 1, tf: 1 });
  
  console.log('[Batch Storage] Indexes ensured');
}
