/**
 * P5.3 — Health Check Scheduler
 * 
 * Runs resolve + health check every 6 hours.
 * Logs results to MongoDB job_runs collection or stdout.
 * 
 * Idempotent: repeated runs create 0 new outcomes.
 */

import cron from 'node-cron';
import { runResolveJob } from './resolve_matured_snapshots.job.js';
import { computeAllHealth, type HealthCheckResult } from '../health/model_health.service.js';
import { getMongoDb } from '../../db/mongoose.js';

interface JobRunResult {
  jobId: string;
  type: 'full' | 'resolve' | 'health';
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  resolve?: {
    totalResolved: number;
    totalSkipped: number;
    errors: string[];
  };
  health?: Array<{
    scope: string;
    grade: string;
    gradeChanged: boolean;
    sampleCount: number;
  }>;
  ok: boolean;
  error?: string;
}

let schedulerTask: cron.ScheduledTask | null = null;

/**
 * Run full job (resolve + health)
 */
async function runFullJob(): Promise<JobRunResult> {
  const startedAt = new Date();
  const jobId = `full_${startedAt.toISOString().replace(/[-:T.]/g, '').slice(0, 14)}`;
  
  console.log(`[Scheduler] Starting full job: ${jobId}`);
  
  try {
    // Step 1: Resolve matured snapshots
    const resolveResult = await runResolveJob();
    
    // Step 2: Recompute health for all scopes
    const healthResults = await computeAllHealth();
    
    const finishedAt = new Date();
    
    const result: JobRunResult = {
      jobId,
      type: 'full',
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      resolve: {
        totalResolved: resolveResult.totalResolved,
        totalSkipped: resolveResult.totalSkipped,
        errors: resolveResult.errors,
      },
      health: healthResults.map(r => ({
        scope: r.scope,
        grade: r.state.grade,
        gradeChanged: r.gradeChanged,
        sampleCount: r.state.metrics.sampleCount,
      })),
      ok: true,
    };
    
    // Log to MongoDB if available
    try {
      const db = await getMongoDb();
      if (db) {
        await db.collection('job_runs').insertOne({
          ...result,
          createdAt: new Date(),
        });
      }
    } catch (dbErr) {
      console.log('[Scheduler] Could not log to MongoDB:', (dbErr as Error).message);
    }
    
    console.log(`[Scheduler] Full job complete: resolved=${result.resolve?.totalResolved}, health grades computed`);
    
    return result;
    
  } catch (err) {
    const finishedAt = new Date();
    const errorMsg = (err as Error).message;
    
    console.error(`[Scheduler] Full job failed: ${errorMsg}`);
    
    return {
      jobId,
      type: 'full',
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      ok: false,
      error: errorMsg,
    };
  }
}

/**
 * Start scheduler (every 6 hours)
 * Cron expression: 0 at minute 0 of every 6th hour
 */
export function startHealthScheduler(): void {
  if (schedulerTask) {
    console.log('[Scheduler] Already running');
    return;
  }
  
  // Every 6 hours: at 00:00, 06:00, 12:00, 18:00
  schedulerTask = cron.schedule('0 */6 * * *', async () => {
    console.log('[Scheduler] Triggered by cron (every 6 hours)');
    await runFullJob();
  }, {
    scheduled: true,
    timezone: 'UTC',
  });
  
  console.log('[Scheduler] Health check scheduler started (every 6 hours)');
}

/**
 * Stop scheduler
 */
export function stopHealthScheduler(): void {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('[Scheduler] Health check scheduler stopped');
  }
}

/**
 * Run job manually (for testing or admin trigger)
 */
export async function triggerManualJob(type: 'full' | 'resolve' | 'health'): Promise<JobRunResult> {
  const startedAt = new Date();
  const jobId = `${type}_manual_${startedAt.toISOString().replace(/[-:T.]/g, '').slice(0, 14)}`;
  
  console.log(`[Scheduler] Manual job triggered: ${jobId}`);
  
  if (type === 'full') {
    return runFullJob();
  }
  
  if (type === 'resolve') {
    const resolveResult = await runResolveJob();
    const finishedAt = new Date();
    return {
      jobId,
      type,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      resolve: {
        totalResolved: resolveResult.totalResolved,
        totalSkipped: resolveResult.totalSkipped,
        errors: resolveResult.errors,
      },
      ok: resolveResult.ok,
    };
  }
  
  if (type === 'health') {
    const healthResults = await computeAllHealth();
    const finishedAt = new Date();
    return {
      jobId,
      type,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      health: healthResults.map(r => ({
        scope: r.scope,
        grade: r.state.grade,
        gradeChanged: r.gradeChanged,
        sampleCount: r.state.metrics.sampleCount,
      })),
      ok: true,
    };
  }
  
  throw new Error(`Unknown job type: ${type}`);
}

export default {
  startHealthScheduler,
  stopHealthScheduler,
  triggerManualJob,
  runFullJob,
};
