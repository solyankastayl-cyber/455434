/**
 * PHASE 4 - БЛОК 4.4: Cron Jobs Service
 * 
 * Scheduled jobs for Shadow ML:
 * 1. Labels Backfill (every 60 minutes)
 * 2. Shadow Evaluation (1-2 times per day)
 * 
 * CRITICAL: NO influence on Engine decisions
 */
import { labelsBackfillService } from './labels_backfill.service.js';
import { shadowEvaluationService } from './shadow_evaluation.service.js';

export class ShadowMLCronService {
  private labelsBackfillInterval: NodeJS.Timeout | null = null;
  private shadowEvalInterval: NodeJS.Timeout | null = null;
  
  private isRunning = false;

  /**
   * Start all cron jobs
   */
  start(): void {
    if (this.isRunning) {
      console.log('[ShadowMLCron] Already running');
      return;
    }

    console.log('[ShadowMLCron] Starting cron jobs...');

    // Labels backfill: every 60 minutes
    this.labelsBackfillInterval = setInterval(
      () => this.runLabelsBackfill(),
      60 * 60 * 1000 // 60 minutes
    );

    // Shadow evaluation: every 12 hours (2x per day)
    this.shadowEvalInterval = setInterval(
      () => this.runShadowEvaluation(),
      12 * 60 * 60 * 1000 // 12 hours
    );

    this.isRunning = true;

    // Run immediately on start
    setTimeout(() => this.runLabelsBackfill(), 5000); // 5 seconds delay
    setTimeout(() => this.runShadowEvaluation(), 10000); // 10 seconds delay

    console.log('[ShadowMLCron] Cron jobs started');
  }

  /**
   * Stop all cron jobs
   */
  stop(): void {
    if (!this.isRunning) {
      console.log('[ShadowMLCron] Not running');
      return;
    }

    console.log('[ShadowMLCron] Stopping cron jobs...');

    if (this.labelsBackfillInterval) {
      clearInterval(this.labelsBackfillInterval);
      this.labelsBackfillInterval = null;
    }

    if (this.shadowEvalInterval) {
      clearInterval(this.shadowEvalInterval);
      this.shadowEvalInterval = null;
    }

    this.isRunning = false;

    console.log('[ShadowMLCron] Cron jobs stopped');
  }

  /**
   * Run labels backfill job
   */
  private async runLabelsBackfill(): Promise<void> {
    try {
      console.log('[ShadowMLCron] Running labels backfill...');
      
      await labelsBackfillService.runFullBackfill(50);
      
      const status = await labelsBackfillService.getStatus();
      console.log('[ShadowMLCron] Labels backfill status:', status);
    } catch (error) {
      console.error('[ShadowMLCron] Labels backfill error:', error);
    }
  }

  /**
   * Run shadow evaluation job
   */
  private async runShadowEvaluation(): Promise<void> {
    try {
      console.log('[ShadowMLCron] Running shadow evaluation...');

      // Run evaluation for 7d window
      const run = await shadowEvaluationService.startRun('7d', 100, 'latest');
      
      console.log(`[ShadowMLCron] Shadow evaluation started: ${run.runId}`);
      
      // Wait for completion
      await this.waitForRunCompletion(run.runId, 60000); // 60 seconds timeout

      const summary = await shadowEvaluationService.getSummary('7d');
      console.log('[ShadowMLCron] Shadow evaluation complete:', {
        accuracy: summary.metrics?.accuracy,
        ece: summary.metrics?.ece,
        agreementRate: summary.metrics?.agreementRate,
      });
    } catch (error) {
      console.error('[ShadowMLCron] Shadow evaluation error:', error);
    }
  }

  /**
   * Wait for run to complete
   */
  private async waitForRunCompletion(runId: string, timeout: number): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const run = await shadowEvaluationService.getRunStatus(runId);
      
      if (!run) {
        throw new Error(`Run ${runId} not found`);
      }

      if (run.status === 'DONE' || run.status === 'FAILED') {
        return;
      }

      // Wait 2 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error(`Run ${runId} timeout`);
  }

  /**
   * Get cron status
   */
  getStatus(): {
    running: boolean;
    labelsBackfillActive: boolean;
    shadowEvalActive: boolean;
  } {
    return {
      running: this.isRunning,
      labelsBackfillActive: this.labelsBackfillInterval !== null,
      shadowEvalActive: this.shadowEvalInterval !== null,
    };
  }
}

export const shadowMLCronService = new ShadowMLCronService();
