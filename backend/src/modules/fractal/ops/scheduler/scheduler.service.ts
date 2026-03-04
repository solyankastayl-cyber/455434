/**
 * BLOCK 80.1 — Scheduler Service
 * 
 * Manages daily-run state with distributed locking.
 */

import { v4 as uuid } from 'uuid';
import { SchedulerStateModel, JobRunModel } from './scheduler.model.js';
import { fractalDailyJobService } from '../../jobs/fractal.daily.job.js';
import { driftAlertService } from '../../drift/drift-alert.service.js';
import { consensusTimelineService } from '../../drift/consensus-timeline.service.js';
import { driftIntelligenceService } from '../../drift/drift-intelligence.service.js';
import { DriftIntelHistoryModel } from '../../drift/drift-intel-history.model.js';

const JOB_ID = 'daily_run_btc';
const LOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes max

interface StepResult {
  name: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  count?: number;
  details?: any;
  error?: string;
}

class SchedulerService {
  
  /**
   * Get or create scheduler state
   */
  async getState() {
    let state = await SchedulerStateModel.findOne({ jobId: JOB_ID });
    
    if (!state) {
      state = await SchedulerStateModel.create({
        jobId: JOB_ID,
        enabled: false,
        scheduleUtc: '00:10',
        timezone: 'UTC',
        lastStatus: 'NEVER',
      });
    }
    
    return state;
  }

  /**
   * Get status for API
   */
  async getStatus() {
    const state = await this.getState();
    const isLocked = state.lock?.lockedUntil && new Date(state.lock.lockedUntil) > new Date();
    
    return {
      jobId: state.jobId,
      enabled: state.enabled,
      scheduleUtc: state.scheduleUtc,
      nextRunAt: state.nextRunAt,
      lastRunAt: state.lastRunAt,
      lastStatus: state.lastStatus,
      lastDurationMs: state.lastDurationMs,
      lastSummary: state.lastSummary,
      lastError: state.lastError,
      isRunning: isLocked,
      currentRunId: isLocked ? state.lock?.runId : null,
    };
  }

  /**
   * Enable daily-run
   */
  async enable() {
    const nextRun = this.calculateNextRun('00:10');
    
    await SchedulerStateModel.updateOne(
      { jobId: JOB_ID },
      { 
        $set: { 
          enabled: true,
          nextRunAt: nextRun,
        } 
      },
      { upsert: true }
    );
    
    return { enabled: true, nextRunAt: nextRun };
  }

  /**
   * Disable daily-run
   */
  async disable() {
    await SchedulerStateModel.updateOne(
      { jobId: JOB_ID },
      { 
        $set: { 
          enabled: false,
          nextRunAt: null,
        } 
      },
      { upsert: true }
    );
    
    return { enabled: false };
  }

  /**
   * Acquire lock for execution
   */
  async acquireLock(runId: string): Promise<boolean> {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + LOCK_DURATION_MS);
    
    // Atomic update - only succeeds if no active lock
    const result = await SchedulerStateModel.updateOne(
      { 
        jobId: JOB_ID,
        $or: [
          { 'lock.lockedUntil': { $lt: now } },
          { 'lock.lockedUntil': null },
          { 'lock': null },
        ]
      },
      {
        $set: {
          'lock.lockedUntil': lockUntil,
          'lock.owner': 'scheduler',
          'lock.runId': runId,
          lastStatus: 'RUNNING',
        }
      }
    );
    
    return result.modifiedCount > 0;
  }

  /**
   * Release lock after execution
   */
  async releaseLock(runId: string) {
    await SchedulerStateModel.updateOne(
      { jobId: JOB_ID, 'lock.runId': runId },
      {
        $set: {
          'lock.lockedUntil': null,
          'lock.owner': null,
          'lock.runId': null,
        }
      }
    );
  }

  /**
   * Run daily pipeline manually
   */
  async runNow(trigger: 'MANUAL' | 'CRON' = 'MANUAL'): Promise<any> {
    const runId = `run_${Date.now()}_${uuid().slice(0, 6)}`;
    const startedAt = new Date();
    
    // Try to acquire lock
    const acquired = await this.acquireLock(runId);
    
    if (!acquired) {
      const state = await this.getState();
      return {
        ok: false,
        status: 'ALREADY_RUNNING',
        currentRunId: state.lock?.runId,
        message: 'Daily run is already in progress',
      };
    }
    
    // Create job run record
    await JobRunModel.create({
      runId,
      jobId: JOB_ID,
      trigger,
      startedAt,
      status: 'RUNNING',
      steps: [],
    });
    
    const steps: StepResult[] = [];
    let finalStatus: 'SUCCESS' | 'FAILED' = 'SUCCESS';
    let errorInfo: any = null;
    
    try {
      // Execute daily pipeline
      const result = await fractalDailyJobService.runDaily('BTC');
      
      // Record steps
      steps.push({
        name: 'SNAPSHOT_WRITE',
        status: 'SUCCESS',
        durationMs: 0,
        count: result.snapshot?.written || 0,
      });
      
      steps.push({
        name: 'OUTCOME_RESOLVE',
        status: 'SUCCESS',
        durationMs: 0,
        count: (result.resolve?.resolved7d || 0) + (result.resolve?.resolved14d || 0) + (result.resolve?.resolved30d || 0),
      });
      
      steps.push({
        name: 'EQUITY_REBUILD',
        status: result.equity?.rebuilt ? 'SUCCESS' : 'SKIPPED',
        durationMs: 0,
      });
      
      steps.push({
        name: 'ALERTS',
        status: 'SUCCESS',
        durationMs: 0,
        count: result.alerts?.sent || 0,
      });
      
      // BLOCK 80.2: Check drift and send TG alert if needed
      let driftAlertResult: any = null;
      try {
        driftAlertResult = await driftAlertService.checkAndAlert('BTC');
        steps.push({
          name: 'DRIFT_CHECK',
          status: driftAlertResult.shouldAlert ? 'SUCCESS' : 'SKIPPED',
          durationMs: 0,
          details: {
            severity: driftAlertResult.severity,
            alerted: driftAlertResult.shouldAlert,
            telegramSent: driftAlertResult.telegramSent,
            rateLimited: driftAlertResult.rateLimited,
          },
        });
      } catch (driftErr: any) {
        console.error('[Scheduler] Drift check failed:', driftErr.message);
        steps.push({
          name: 'DRIFT_CHECK',
          status: 'FAILED',
          durationMs: 0,
          error: driftErr.message,
        });
      }
      
      // BLOCK 80.3: Write consensus timeline snapshot
      let timelineResult: any = null;
      try {
        timelineResult = await consensusTimelineService.buildAndWriteSnapshot('BTC');
        steps.push({
          name: 'TIMELINE_WRITE',
          status: timelineResult.written ? 'SUCCESS' : 'SKIPPED',
          durationMs: 0,
          details: {
            date: timelineResult.date,
            consensusIndex: timelineResult.consensusIndex,
          },
        });
      } catch (timelineErr: any) {
        console.error('[Scheduler] Timeline write failed:', timelineErr.message);
        steps.push({
          name: 'TIMELINE_WRITE',
          status: 'FAILED',
          durationMs: 0,
          error: timelineErr.message,
        });
      }
      
      // BLOCK 81: Write drift intelligence snapshot
      let driftIntelResult: any = null;
      try {
        const intel = await driftIntelligenceService.computeDriftIntelligence({
          symbol: 'BTC',
          windowDays: 90,
        });
        
        const date = new Date().toISOString().split('T')[0];
        const delta = intel.deltas.LIVE_vs_V2020;
        
        await DriftIntelHistoryModel.updateOne(
          { symbol: 'BTC', date, source: 'LIVE' },
          {
            $set: {
              severity: intel.verdict.severity,
              confidence: intel.verdict.confidence,
              insufficientLiveTruth: intel.verdict.insufficientLiveTruth,
              liveSamples: intel.live.metrics.samples,
              dHitRate_pp: delta?.dHitRate_pp || 0,
              dSharpe: delta?.dSharpe || 0,
              dCalibration_pp: delta?.dCalibration_pp || 0,
              dMaxDD_pp: delta?.dMaxDD_pp || 0,
              baseline: 'V2020',
              reasons: intel.verdict.reasons,
              engineVersion: intel.meta.engineVersion,
            },
          },
          { upsert: true }
        );
        
        driftIntelResult = {
          written: true,
          severity: intel.verdict.severity,
          confidence: intel.verdict.confidence,
          liveSamples: intel.live.metrics.samples,
        };
        
        steps.push({
          name: 'DRIFT_INTELLIGENCE_WRITE',
          status: 'SUCCESS',
          durationMs: 0,
          details: {
            date,
            severity: intel.verdict.severity,
            confidence: intel.verdict.confidence,
          },
        });
        
        console.log(`[Scheduler] Drift Intelligence snapshot written for BTC @ ${date}`);
        
      } catch (driftIntelErr: any) {
        console.error('[Scheduler] Drift Intelligence write failed:', driftIntelErr.message);
        steps.push({
          name: 'DRIFT_INTELLIGENCE_WRITE',
          status: 'FAILED',
          durationMs: 0,
          error: driftIntelErr.message,
        });
      }
      
      // Update state with results
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      
      await SchedulerStateModel.updateOne(
        { jobId: JOB_ID },
        {
          $set: {
            lastRunAt: startedAt,
            lastStatus: 'SUCCESS',
            lastDurationMs: durationMs,
            lastSummary: {
              steps,
              alertsSent: result.alerts?.sent || 0,
              snapshotsWritten: result.snapshot?.written || 0,
              outcomesResolved: result.memory?.outcomesResolved || 0,
              driftSeverity: driftAlertResult?.severity,
              driftAlerted: driftAlertResult?.shouldAlert,
            },
            lastError: null,
            nextRunAt: this.calculateNextRun('00:10'),
          }
        }
      );
      
      // Update job run record
      await JobRunModel.updateOne(
        { runId },
        {
          $set: {
            finishedAt,
            status: 'SUCCESS',
            durationMs,
            steps,
            summary: {
              snapshotsWritten: result.snapshot?.written || 0,
              outcomesResolved: result.memory?.outcomesResolved || 0,
              alertsSent: result.alerts?.sent || 0,
            },
          }
        }
      );
      
      return {
        ok: true,
        status: 'SUCCESS',
        runId,
        durationMs,
        steps,
        result,
      };
      
    } catch (err: any) {
      finalStatus = 'FAILED';
      errorInfo = {
        code: err.code || 'EXECUTION_ERROR',
        message: err.message,
        stack: err.stack?.slice(0, 500),
      };
      
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      
      // Update state with error
      await SchedulerStateModel.updateOne(
        { jobId: JOB_ID },
        {
          $set: {
            lastRunAt: startedAt,
            lastStatus: 'FAILED',
            lastDurationMs: durationMs,
            lastError: {
              code: errorInfo.code,
              message: errorInfo.message,
              timestamp: new Date(),
            },
          }
        }
      );
      
      // Update job run record
      await JobRunModel.updateOne(
        { runId },
        {
          $set: {
            finishedAt,
            status: 'FAILED',
            durationMs,
            steps,
            error: errorInfo,
          }
        }
      );
      
      return {
        ok: false,
        status: 'FAILED',
        runId,
        durationMs,
        error: errorInfo.message,
      };
      
    } finally {
      // Always release lock
      await this.releaseLock(runId);
    }
  }

  /**
   * Get job history
   */
  async getHistory(limit: number = 30) {
    const runs = await JobRunModel.find({ jobId: JOB_ID })
      .sort({ startedAt: -1 })
      .limit(limit)
      .lean();
    
    return runs.map(r => ({
      runId: r.runId,
      trigger: r.trigger,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      status: r.status,
      durationMs: r.durationMs,
      steps: r.steps,
      summary: r.summary,
      error: r.error,
    }));
  }

  /**
   * Calculate next run time
   */
  private calculateNextRun(scheduleUtc: string): Date {
    const [hours, minutes] = scheduleUtc.split(':').map(Number);
    const now = new Date();
    const next = new Date(now);
    
    next.setUTCHours(hours, minutes, 0, 0);
    
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    
    return next;
  }
}

export const schedulerService = new SchedulerService();

export default schedulerService;
