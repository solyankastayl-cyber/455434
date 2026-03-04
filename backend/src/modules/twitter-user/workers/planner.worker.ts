/**
 * TwitterPlannerWorker - автоматический планировщик
 * 
 * Cron job: каждые N минут проверяет юзеров и планирует задачи
 */

import { TwitterSchedulerService } from '../services/scheduler.service.js';
import { UserTwitterQuotaModel } from '../models/user-twitter-quota.model.js';
import { TwitterIntegrationSnapshotModel } from '../models/twitter-integration-snapshot.model.js';
import { TwitterIntegrationState } from '../types/twitter-integration-state.js';

/** Worker configuration */
const CONFIG = {
  intervalMs: 2 * 60 * 1000, // 2 minutes
  maxUsersPerRun: 50,
};

export class TwitterPlannerWorker {
  private scheduler: TwitterSchedulerService;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private enabled = false;
  
  private stats = {
    lastRunAt: null as Date | null,
    usersProcessed: 0,
    tasksPlanned: 0,
    errors: 0,
  };

  constructor() {
    this.scheduler = new TwitterSchedulerService();
  }

  /**
   * Start the planner worker
   */
  start(): void {
    if (this.intervalId) return;
    
    this.enabled = true;
    console.log('[PlannerWorker] Starting with interval', CONFIG.intervalMs, 'ms');
    
    // Run immediately
    this.run();
    
    // Then on interval
    this.intervalId = setInterval(() => this.run(), CONFIG.intervalMs);
  }

  /**
   * Stop the planner worker
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.enabled = false;
    console.log('[PlannerWorker] Stopped');
  }

  /**
   * Get current status
   */
  getStatus(): {
    enabled: boolean;
    isRunning: boolean;
    lastRunAt: Date | null;
    stats: typeof this.stats;
  } {
    return {
      enabled: this.enabled,
      isRunning: this.isRunning,
      lastRunAt: this.stats.lastRunAt,
      stats: { ...this.stats },
    };
  }

  /**
   * Run one planning cycle
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      console.log('[PlannerWorker] Already running, skipping');
      return;
    }

    this.isRunning = true;
    this.stats.lastRunAt = new Date();
    
    let usersProcessed = 0;
    let tasksPlanned = 0;
    let errors = 0;

    try {
      // Get users with active sessions
      const activeUsers = await this.getActiveUsers();
      
      console.log(`[PlannerWorker] Processing ${activeUsers.length} active users`);

      for (const userId of activeUsers.slice(0, CONFIG.maxUsersPerRun)) {
        try {
          const result = await this.scheduler.planAndCommit(userId);
          
          if (result.committed > 0) {
            console.log(`[PlannerWorker] User ${userId}: ${result.committed} tasks planned`);
            tasksPlanned += result.committed;
          }
          
          usersProcessed++;
        } catch (err: any) {
          console.error(`[PlannerWorker] Error for user ${userId}:`, err.message);
          errors++;
        }
      }

      this.stats.usersProcessed = usersProcessed;
      this.stats.tasksPlanned = tasksPlanned;
      this.stats.errors = errors;

      console.log(`[PlannerWorker] Cycle complete: ${usersProcessed} users, ${tasksPlanned} tasks, ${errors} errors`);
    } catch (err: any) {
      console.error('[PlannerWorker] Fatal error:', err.message);
      this.stats.errors++;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get list of users with active sessions
   */
  private async getActiveUsers(): Promise<string[]> {
    // Find users with SESSION_OK or SESSION_STALE
    const snapshots = await TwitterIntegrationSnapshotModel.find({
      lastState: { $in: [TwitterIntegrationState.SESSION_OK, TwitterIntegrationState.SESSION_STALE] },
    }).lean();

    return snapshots.map(s => s.ownerUserId);
  }

  /**
   * Manual trigger (for API)
   */
  async runOnce(): Promise<{
    usersProcessed: number;
    tasksPlanned: number;
    errors: number;
  }> {
    await this.run();
    return {
      usersProcessed: this.stats.usersProcessed,
      tasksPlanned: this.stats.tasksPlanned,
      errors: this.stats.errors,
    };
  }
}

// Singleton instance
let plannerWorkerInstance: TwitterPlannerWorker | null = null;

export function getPlannerWorker(): TwitterPlannerWorker {
  if (!plannerWorkerInstance) {
    plannerWorkerInstance = new TwitterPlannerWorker();
  }
  return plannerWorkerInstance;
}
