/**
 * OUTCOME TRACKER JOB
 * ===================
 * 
 * V3.4: Outcome Tracking - Background job
 * 
 * Runs periodically to:
 * 1. Resolve pending snapshots that have passed their horizon
 * 2. Log statistics
 */

import type { Db } from 'mongodb';
import { OutcomeTrackerService, getOutcomeTrackerService, type PriceProvider } from './outcome-tracker.service.js';

export type OutcomeTrackerJobConfig = {
  enabled: boolean;
  intervalMs: number;  // How often to run (default: 5 minutes)
};

export class OutcomeTrackerJob {
  private service: OutcomeTrackerService;
  private config: OutcomeTrackerJobConfig;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(db: Db, priceProvider: PriceProvider, config?: Partial<OutcomeTrackerJobConfig>) {
    this.service = getOutcomeTrackerService(db, priceProvider);
    this.config = {
      enabled: config?.enabled ?? true,
      intervalMs: config?.intervalMs ?? 5 * 60 * 1000, // 5 minutes default
    };
  }

  /**
   * Start the background job
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('[OutcomeTrackerJob] Job is disabled');
      return;
    }

    if (this.intervalId) {
      console.log('[OutcomeTrackerJob] Job already running');
      return;
    }

    console.log(`[OutcomeTrackerJob] Starting job (interval: ${this.config.intervalMs}ms)`);
    
    // Run immediately
    this.run().catch(err => {
      console.error('[OutcomeTrackerJob] Initial run error:', err.message);
    });

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      this.run().catch(err => {
        console.error('[OutcomeTrackerJob] Periodic run error:', err.message);
      });
    }, this.config.intervalMs);
  }

  /**
   * Stop the background job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[OutcomeTrackerJob] Job stopped');
    }
  }

  /**
   * Run one iteration of the job
   */
  async run(): Promise<{
    processed: number;
    wins: number;
    losses: number;
    errors: number;
  }> {
    console.log('[OutcomeTrackerJob] Running...');
    
    const result = await this.service.processPendingSnapshots();
    
    if (result.processed > 0) {
      console.log(
        `[OutcomeTrackerJob] Processed ${result.processed} snapshots: ` +
        `${result.wins} wins, ${result.losses} losses, ${result.errors} errors`
      );
    }
    
    return result;
  }

  /**
   * Get job status
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}

// Singleton instance
let jobInstance: OutcomeTrackerJob | null = null;

export function getOutcomeTrackerJob(
  db: Db,
  priceProvider: PriceProvider,
  config?: Partial<OutcomeTrackerJobConfig>
): OutcomeTrackerJob {
  if (!jobInstance) {
    jobInstance = new OutcomeTrackerJob(db, priceProvider, config);
  }
  return jobInstance;
}

/**
 * Register and start the job
 */
export function registerOutcomeTrackerJob(
  db: Db,
  priceProvider: PriceProvider,
  config?: Partial<OutcomeTrackerJobConfig>
): OutcomeTrackerJob {
  const job = getOutcomeTrackerJob(db, priceProvider, config);
  job.start();
  return job;
}

console.log('[OutcomeTrackerJob] V3.4 Job loaded');
