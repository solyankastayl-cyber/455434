/**
 * Phase N3: Engine Scheduler
 * 
 * Background orchestration for automatic TA runs
 */

import cron from 'node-cron';
import { Db } from 'mongodb';

export interface SchedulerConfig {
  enabled: boolean;
  assets: string[];
  intervals: {
    mtf: string;      // cron expression for MTF (default: every 15 min)
    decision1D: string;
    decision4H: string;
    decision1H: string;
    outboxPump: string;
  };
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: true,
  assets: ['BTCUSDT', 'ETHUSDT'],
  intervals: {
    mtf: '*/15 * * * *',        // Every 15 min
    decision1D: '*/15 * * * *', // Every 15 min
    decision4H: '*/5 * * * *',  // Every 5 min
    decision1H: '*/2 * * * *',  // Every 2 min
    outboxPump: '*/5 * * * * *', // Every 5 sec (cron with seconds)
  },
};

interface SchedulerDeps {
  db: Db;
  runMTF?: (params: { asset: string }) => Promise<any>;
  runDecision?: (params: { asset: string; timeframe: string }) => Promise<any>;
  pumpOutbox?: () => Promise<any>;
  logger?: (msg: string, data?: any) => void;
}

const scheduledTasks: cron.ScheduledTask[] = [];
let schedulerStats = {
  mtfRuns: 0,
  decisionRuns: 0,
  outboxPumps: 0,
  errors: 0,
  lastRun: null as Date | null,
  startedAt: null as Date | null,
};

/**
 * Start the scheduler
 */
export function startScheduler(deps: SchedulerDeps, config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): void {
  if (!config.enabled) {
    console.log('[Scheduler] Disabled by config');
    return;
  }

  const log = deps.logger || console.log;
  schedulerStats.startedAt = new Date();

  // MTF runs (every 15 min)
  if (deps.runMTF) {
    const mtfTask = cron.schedule(config.intervals.mtf, async () => {
      for (const asset of config.assets) {
        try {
          log(`[Scheduler] Running MTF for ${asset}`);
          await deps.runMTF!({ asset });
          schedulerStats.mtfRuns++;
          schedulerStats.lastRun = new Date();
        } catch (err: any) {
          log(`[Scheduler] MTF error for ${asset}: ${err.message}`);
          schedulerStats.errors++;
        }
      }
    });
    scheduledTasks.push(mtfTask);
  }

  // 1D decisions (every 15 min)
  if (deps.runDecision) {
    const task1D = cron.schedule(config.intervals.decision1D, async () => {
      for (const asset of config.assets) {
        try {
          await deps.runDecision!({ asset, timeframe: '1d' });
          schedulerStats.decisionRuns++;
        } catch (err: any) {
          schedulerStats.errors++;
        }
      }
    });
    scheduledTasks.push(task1D);
  }

  // Outbox pump (every 5 sec)
  if (deps.pumpOutbox) {
    const pumpTask = cron.schedule(config.intervals.outboxPump, async () => {
      try {
        await deps.pumpOutbox!();
        schedulerStats.outboxPumps++;
      } catch (err: any) {
        schedulerStats.errors++;
      }
    }, { scheduled: true });
    scheduledTasks.push(pumpTask);
  }

  log(`[Scheduler] Started with ${config.assets.length} assets, ${scheduledTasks.length} tasks`);
}

/**
 * Stop all scheduled tasks
 */
export function stopScheduler(): void {
  for (const task of scheduledTasks) {
    task.stop();
  }
  scheduledTasks.length = 0;
  console.log('[Scheduler] Stopped');
}

/**
 * Get scheduler stats
 */
export function getSchedulerStats(): typeof schedulerStats & { tasksCount: number; isRunning: boolean } {
  return {
    ...schedulerStats,
    tasksCount: scheduledTasks.length,
    isRunning: scheduledTasks.length > 0,
  };
}

/**
 * Reset scheduler stats
 */
export function resetSchedulerStats(): void {
  schedulerStats = {
    mtfRuns: 0,
    decisionRuns: 0,
    outboxPumps: 0,
    errors: 0,
    lastRun: null,
    startedAt: schedulerStats.startedAt,
  };
}
