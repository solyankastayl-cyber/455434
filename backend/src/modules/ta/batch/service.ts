/**
 * Phase 7: Batch Simulation Service
 * 
 * Main service for creating and managing batch runs.
 */

import { v4 as uuid } from 'uuid';
import {
  BatchRun,
  BatchTask,
  CreateBatchRunRequest,
  DEFAULT_CONFIG,
  BatchRunSummary,
  EstimateResult,
} from './domain.js';
import * as storage from './storage.js';
import { createTasks, estimateRun } from './planner.js';
import { startWorker, stopWorker, isWorkerRunning } from './runner.js';
import { logger } from '../infra/logger.js';

// ═══════════════════════════════════════════════════════════════
// CREATE RUN
// ═══════════════════════════════════════════════════════════════

export async function createBatchRun(request: CreateBatchRunRequest): Promise<BatchRun> {
  const runId = uuid();
  const now = Date.now();
  
  const run: BatchRun = {
    runId,
    name: request.name || `Batch ${new Date().toISOString().slice(0, 10)}`,
    symbols: request.symbols,
    tfs: request.tfs,
    dateRanges: [{ startTs: request.startTs, endTs: request.endTs }],
    config: {
      ...DEFAULT_CONFIG,
      ...request.config,
    },
    status: 'CREATED',
    progress: {
      totalTasks: 0,
      pendingTasks: 0,
      runningTasks: 0,
      doneTasks: 0,
      failedTasks: 0,
      rowsWritten: 0,
      tradesClosed: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
  
  // Create tasks
  const { tasks, totalBars, estimatedTrades } = createTasks(run);
  
  run.progress.totalTasks = tasks.length;
  run.progress.pendingTasks = tasks.length;
  
  // Save to DB
  await storage.insertRun(run);
  await storage.insertTasks(tasks);
  
  logger.info({
    phase: 'batch_service',
    runId,
    tasks: tasks.length,
    totalBars,
    estimatedTrades,
  }, 'Batch run created');
  
  return run;
}

// ═══════════════════════════════════════════════════════════════
// START/STOP
// ═══════════════════════════════════════════════════════════════

export async function startBatchRun(runId: string): Promise<{ ok: boolean; message: string }> {
  const run = await storage.getRun(runId);
  if (!run) {
    return { ok: false, message: 'Run not found' };
  }
  
  if (run.status === 'RUNNING') {
    return { ok: false, message: 'Run already running' };
  }
  
  if (run.status === 'DONE') {
    return { ok: false, message: 'Run already completed' };
  }
  
  await storage.updateRunStatus(runId, 'RUNNING');
  
  // Start worker in background
  startWorker(runId, run.config.deterministicSeed).catch(e => {
    logger.error({ phase: 'batch_service', runId, error: e.message }, 'Worker error');
  });
  
  return { ok: true, message: 'Run started' };
}

export async function cancelBatchRun(runId: string): Promise<{ ok: boolean; message: string }> {
  const run = await storage.getRun(runId);
  if (!run) {
    return { ok: false, message: 'Run not found' };
  }
  
  stopWorker();
  await storage.updateRunStatus(runId, 'CANCELLED');
  
  return { ok: true, message: 'Run cancelled' };
}

// ═══════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════

export async function getBatchRunStatus(runId: string): Promise<BatchRun | null> {
  const run = await storage.getRun(runId);
  if (!run) return null;
  
  // Refresh progress from tasks
  const stats = await storage.getTaskStats(runId);
  run.progress.pendingTasks = stats.pending;
  run.progress.runningTasks = stats.running;
  run.progress.doneTasks = stats.done;
  run.progress.failedTasks = stats.failed;
  run.progress.rowsWritten = stats.rowsWritten;
  run.progress.tradesClosed = stats.tradesClosed;
  
  // Calculate win rate if we have trades
  if (stats.tradesClosed > 0) {
    // Would need to query dataset for this - simplified
    run.progress.winRate = undefined;
    run.progress.avgR = undefined;
  }
  
  return run;
}

export async function listBatchRuns(limit: number = 20): Promise<BatchRunSummary[]> {
  const runs = await storage.listRuns(limit);
  
  return runs.map(r => ({
    runId: r.runId,
    name: r.name,
    status: r.status,
    symbols: r.symbols,
    tfs: r.tfs,
    progress: r.progress,
    createdAt: r.createdAt,
  }));
}

// ═══════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════

export async function getRunTasks(runId: string, status?: string): Promise<BatchTask[]> {
  return storage.getTasksByRun(runId, status as any);
}

// ═══════════════════════════════════════════════════════════════
// REPAIR
// ═══════════════════════════════════════════════════════════════

export async function requeueFailedTasks(runId: string): Promise<number> {
  const count = await storage.requeueFailedTasks(runId);
  
  if (count > 0) {
    await storage.updateRunStatus(runId, 'RUNNING');
    const run = await storage.getRun(runId);
    if (run) {
      startWorker(runId, run.config.deterministicSeed).catch(() => {});
    }
  }
  
  return count;
}

export async function releaseStuckTasks(runId: string): Promise<number> {
  return storage.releaseStuckTasks(runId);
}

// ═══════════════════════════════════════════════════════════════
// ESTIMATE
// ═══════════════════════════════════════════════════════════════

export function estimateBatchRun(
  symbols: string[],
  tfs: string[],
  startTs: number,
  endTs: number
): EstimateResult {
  return estimateRun(symbols, tfs, startTs, endTs);
}

// ═══════════════════════════════════════════════════════════════
// WORKER STATUS
// ═══════════════════════════════════════════════════════════════

export function getWorkerStatus(): { running: boolean } {
  return { running: isWorkerRunning() };
}
