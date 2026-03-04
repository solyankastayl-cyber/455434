// System Scheduler Service - v0 (SYSTEM ONLY)
// Safe, predictable auto-run of SYSTEM parsing with policy + preflight respect

import { TwitterAccountModel } from '../accounts/account.model.js';
import { TwitterSessionModel } from '../sessions/session.model.js';
import { TwitterTaskModel, TaskStatus } from '../execution/queue/task.model.js';
import { SystemParseLogModel, SystemParseLogStatus } from './system-parse-log.model.js';
import { runTwitterPreflight } from '../preflight/preflight.service.js';
import { runSystemParse } from './admin-system.service.js';
import { notifySystemParseBlocked, notifyHighAbortRate } from './system-telegram.notifier.js';
import { ExecutionScope, OwnerType } from '../core/execution-scope.js';
import { getPolicyLimits } from '../core/scope-policy.service.js';

// Scheduler configuration
export interface SchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxConcurrentTasks: number;
  topKPerTick: number;
}

// Scheduler status
export interface SchedulerStatus {
  enabled: boolean;
  intervalMinutes: number;
  maxConcurrentTasks: number;
  topKPerTick: number;
  runningTasks: number;
  lastTickAt?: string;
  nextTickAt?: string;
  lastTickResult?: TickResult;
}

// Tick result
export interface TickResult {
  attempted: number;
  started: number;
  blocked: number;
  skippedPolicy: number;
  skippedBusy: number;
  skippedNoSession: number;
}

class SystemScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt: Date | null = null;
  private lastTickResult: TickResult | null = null;
  private isRunning: boolean = false;

  /**
   * Get scheduler configuration from ENV
   */
  getConfig(): SchedulerConfig {
    const enabled = (process.env.SYSTEM_SCHEDULER_ENABLED ?? 'false') === 'true';
    const intervalMinutes = parseInt(process.env.SYSTEM_SCHEDULER_INTERVAL_MINUTES ?? '15', 10);
    const maxConcurrentTasks = parseInt(process.env.SYSTEM_SCHEDULER_MAX_CONCURRENT ?? '2', 10);
    const topKPerTick = parseInt(process.env.SYSTEM_SCHEDULER_TOPK ?? '5', 10);

    return {
      enabled,
      intervalMinutes: Number.isFinite(intervalMinutes) ? intervalMinutes : 15,
      maxConcurrentTasks: Number.isFinite(maxConcurrentTasks) ? maxConcurrentTasks : 2,
      topKPerTick: Number.isFinite(topKPerTick) ? topKPerTick : 5,
    };
  }

  /**
   * Start scheduler loop
   */
  start(): void {
    const cfg = this.getConfig();
    
    if (!cfg.enabled) {
      console.log('[SystemScheduler] Disabled via config, not starting');
      return;
    }

    // Stop previous timer if exists
    this.stop();

    const ms = Math.max(1, cfg.intervalMinutes) * 60_000;
    
    console.log(`[SystemScheduler] Starting with interval ${cfg.intervalMinutes}min, max ${cfg.maxConcurrentTasks} concurrent tasks`);
    
    this.timer = setInterval(() => {
      this.tick().catch(err => {
        console.error('[SystemScheduler] Tick error:', err);
      });
    }, ms);

    // Run first tick after 30 seconds (give system time to warm up)
    setTimeout(() => {
      this.tick().catch(err => {
        console.error('[SystemScheduler] Initial tick error:', err);
      });
    }, 30_000);

    this.isRunning = true;
  }

  /**
   * Stop scheduler
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[SystemScheduler] Stopped');
  }

  /**
   * Get current scheduler status
   */
  async getStatus(): Promise<SchedulerStatus> {
    const cfg = this.getConfig();
    const runningTasks = await this.countRunningSystemTasks();
    
    let nextTickAt: string | undefined;
    if (this.isRunning && this.lastTickAt) {
      const nextTick = new Date(this.lastTickAt.getTime() + cfg.intervalMinutes * 60_000);
      nextTickAt = nextTick.toISOString();
    }

    return {
      enabled: cfg.enabled,
      intervalMinutes: cfg.intervalMinutes,
      maxConcurrentTasks: cfg.maxConcurrentTasks,
      topKPerTick: cfg.topKPerTick,
      runningTasks,
      lastTickAt: this.lastTickAt?.toISOString(),
      nextTickAt,
      lastTickResult: this.lastTickResult ?? undefined,
    };
  }

  /**
   * Manual or scheduled tick - main scheduler logic
   */
  async tick(): Promise<TickResult> {
    const cfg = this.getConfig();
    this.lastTickAt = new Date();

    const result: TickResult = {
      attempted: 0,
      started: 0,
      blocked: 0,
      skippedPolicy: 0,
      skippedBusy: 0,
      skippedNoSession: 0,
    };

    console.log('[SystemScheduler] Tick started');

    // Guard: scheduler disabled
    if (!cfg.enabled) {
      console.log('[SystemScheduler] Scheduler disabled, skipping tick');
      this.lastTickResult = result;
      return result;
    }

    // Guard: too many running tasks
    const running = await this.countRunningSystemTasks();
    if (running >= cfg.maxConcurrentTasks) {
      console.log(`[SystemScheduler] Max concurrent tasks reached (${running}/${cfg.maxConcurrentTasks}), skipping tick`);
      result.skippedBusy++;
      this.lastTickResult = result;
      return result;
    }

    const availableSlots = Math.max(0, cfg.maxConcurrentTasks - running);
    
    // Select candidate accounts
    const candidates = await this.selectCandidates(cfg.topKPerTick);
    console.log(`[SystemScheduler] Found ${candidates.length} candidates, ${availableSlots} slots available`);

    // Process each candidate
    for (const account of candidates) {
      if (result.started >= availableSlots) break;

      result.attempted++;
      const username = account.username;

      // 1) Find active session for account
      const session = await TwitterSessionModel.findOne({
        accountId: account._id,
        scope: ExecutionScope.SYSTEM,
        status: 'OK',
      }).lean();

      if (!session) {
        console.log(`[SystemScheduler] No OK session for @${username}, skipping`);
        result.skippedNoSession++;
        continue;
      }

      // 2) Policy check (simple: count tasks in last hour)
      const limits = getPolicyLimits(ExecutionScope.SYSTEM);
      const tasksLastHour = await TwitterTaskModel.countDocuments({
        scope: ExecutionScope.SYSTEM,
        accountId: account._id.toString(),
        createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
      });

      if (tasksLastHour >= limits.maxTasksPerHour) {
        console.log(`[SystemScheduler] Policy limit reached for @${username} (${tasksLastHour}/${limits.maxTasksPerHour})`);
        result.skippedPolicy++;
        continue;
      }

      // 3) Preflight gate
      const preflight = await runTwitterPreflight(session.sessionId);
      
      if (!preflight.canRun) {
        console.log(`[SystemScheduler] Preflight BLOCKED for @${username}: ${preflight.blockers.map(b => b.code).join(', ')}`);
        result.blocked++;

        // Log blocked
        await SystemParseLogModel.create({
          sessionId: session.sessionId,
          accountId: account._id.toString(),
          status: SystemParseLogStatus.BLOCKED,
          reason: 'SCHEDULER_PREFLIGHT_FAILED',
          blockers: preflight.blockers,
        });

        // Telegram alert (don't await)
        notifySystemParseBlocked(session.sessionId, username, preflight.blockers).catch(err => {
          console.error('[SystemScheduler] Failed to send blocked alert:', err);
        });

        continue;
      }

      // 4) Run parse!
      console.log(`[SystemScheduler] Starting parse for @${username}`);
      
      try {
        // Get default target (account's own timeline for now)
        const parseResult = await runSystemParse({
          sessionId: session.sessionId,
          target: `@${username}`,
          type: 'ACCOUNT_TWEETS',
          limit: 20,
        });

        if (parseResult.ok) {
          console.log(`[SystemScheduler] Parse SUCCESS for @${username}`);
          result.started++;
          
          // Update lastRunAt on account
          await TwitterAccountModel.updateOne(
            { _id: account._id },
            { $set: { lastRunAt: new Date() } }
          );
        } else if (parseResult.blocked) {
          // Blocked by preflight inside runSystemParse (shouldn't happen here, but handle it)
          result.blocked++;
        } else {
          // Failed
          console.log(`[SystemScheduler] Parse FAILED for @${username}: ${parseResult.error}`);
        }
      } catch (err: any) {
        console.error(`[SystemScheduler] Parse error for @${username}:`, err.message);
      }
    }

    // Check abort rate and alert if high
    await this.checkAbortRate();

    console.log(`[SystemScheduler] Tick completed: attempted=${result.attempted}, started=${result.started}, blocked=${result.blocked}`);
    this.lastTickResult = result;
    return result;
  }

  /**
   * Count currently running SYSTEM tasks
   */
  private async countRunningSystemTasks(): Promise<number> {
    return TwitterTaskModel.countDocuments({
      scope: ExecutionScope.SYSTEM,
      status: { $in: [TaskStatus.RUNNING, TaskStatus.PENDING] },
    });
  }

  /**
   * Select candidate accounts for parsing
   * Criteria: SYSTEM, ACTIVE, not in cooldown, sorted by lastRunAt ASC
   */
  private async selectCandidates(limit: number) {
    return TwitterAccountModel.find({
      ownerType: OwnerType.SYSTEM,
      status: 'ACTIVE',
    })
      .sort({ lastRunAt: 1, createdAt: 1 }) // Oldest first
      .limit(Math.max(1, limit))
      .lean();
  }

  /**
   * Check abort rate and send alert if too high
   */
  private async checkAbortRate(): Promise<void> {
    const windowSize = 10;
    const threshold = 40; // 40%

    const recentLogs = await SystemParseLogModel.find({})
      .sort({ createdAt: -1 })
      .limit(windowSize)
      .lean();

    if (recentLogs.length < windowSize) return;

    const failedCount = recentLogs.filter(
      l => l.status === SystemParseLogStatus.BLOCKED || l.status === SystemParseLogStatus.ABORTED
    ).length;

    const abortRate = Math.round((failedCount / windowSize) * 100);

    if (abortRate >= threshold) {
      const accountIds = new Set(recentLogs.map(l => l.accountId).filter(Boolean));
      
      notifyHighAbortRate(abortRate, windowSize, accountIds.size).catch(err => {
        console.error('[SystemScheduler] Failed to send high abort rate alert:', err);
      });
    }
  }
}

// Singleton instance
export const systemScheduler = new SystemScheduler();
