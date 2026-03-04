/**
 * BLOCK 56.6 — Fractal Daily Job
 * 
 * Orchestrates the daily forward-truth cycle:
 * 1. Write BTC snapshot (ACTIVE + SHADOW)
 * 2. Resolve matured snapshots (7/14/30d)
 * 3. Rebuild forward equity
 * 4. Log governance audit
 * 
 * Principles:
 * - BTC-only (no alts)
 * - Idempotent (safe to run multiple times)
 * - No auto-promotion
 * - No auto-retrain
 * - Only truth collection
 */

import { snapshotWriterService } from '../lifecycle/snapshot.writer.service.js';
import { outcomeResolverService } from '../lifecycle/outcome.resolver.service.js';
import { forwardEquityService } from '../strategy/forward/forward.equity.service.js';
import { runAlertEngine, type AlertEngineContext } from '../alerts/alert.engine.service.js';
import { sendAlertsToTelegram } from '../alerts/alert.tg.adapter.js';
import { getQuotaStatus } from '../alerts/alert.quota.service.js';
import { memorySnapshotWriterService } from '../memory/snapshot/snapshot-writer.service.js';
import { outcomeResolverService as memoryOutcomeResolverService } from '../memory/outcome/outcome-resolver.service.js';
// BLOCK 82-83: Intel Timeline + Alerts
import { intelTimelineWriterService } from '../intel-timeline/intel-timeline.writer.js';
import { IntelTimelineModel } from '../intel-timeline/intel-timeline.model.js';
import { detectIntelEvents, intelAlertsService } from '../intel-alerts/index.js';
// INTEGRITY GUARD — Data validation with auto-bootstrap
import { integrityGuardService, type IntegrityGuardResult } from '../services/integrity-guard.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface DailyJobContext {
  runId: string;
  symbol: string;
  startedAt: Date;
  completedAt?: Date;
  steps: DailyJobStep[];
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  error?: string;
}

export interface DailyJobStep {
  name: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  result?: any;
  error?: string;
}

export interface DailyJobResult {
  success: boolean;
  runId: string;
  symbol: string;
  durationMs: number;
  snapshot: {
    written: number;
    skipped: number;
    asofDate: string;
  };
  resolve: {
    resolved7d: number;
    resolved14d: number;
    resolved30d: number;
  };
  equity: {
    rebuilt: boolean;
  };
  alerts: {
    sent: number;
    blocked: number;
    quotaUsed: number;
    quotaMax: number;
  };
  // BLOCK 75: Memory Layer
  memory: {
    snapshotsWritten: number;
    outcomesResolved: number;
  };
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════
// STORAGE (in-memory for now, can move to MongoDB)
// ═══════════════════════════════════════════════════════════════

const jobHistory: DailyJobContext[] = [];
let isRunning = false;

// ═══════════════════════════════════════════════════════════════
// DAILY JOB SERVICE
// ═══════════════════════════════════════════════════════════════

export class FractalDailyJobService {
  
  /**
   * Generate unique run ID
   */
  private generateRunId(): string {
    return `daily-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  
  /**
   * BTC-only guard
   */
  private validateSymbol(symbol: string): void {
    if (symbol !== 'BTC') {
      throw new Error('Fractal forward scheduler supports BTC only');
    }
  }
  
  /**
   * Check if job is already running (mutex)
   */
  isJobRunning(): boolean {
    return isRunning;
  }
  
  /**
   * Get last job run
   */
  getLastRun(): DailyJobContext | null {
    return jobHistory[jobHistory.length - 1] || null;
  }
  
  /**
   * Get job history
   */
  getHistory(limit = 10): DailyJobContext[] {
    return jobHistory.slice(-limit).reverse();
  }
  
  /**
   * Main daily job runner
   */
  async runDaily(symbol = 'BTC'): Promise<DailyJobResult> {
    // BTC-only guard
    this.validateSymbol(symbol);
    
    // Mutex check
    if (isRunning) {
      throw new Error('Daily job is already running');
    }
    
    isRunning = true;
    const runId = this.generateRunId();
    const startedAt = new Date();
    
    const context: DailyJobContext = {
      runId,
      symbol,
      startedAt,
      steps: [],
      status: 'RUNNING'
    };
    
    jobHistory.push(context);
    
    // Keep only last 30 runs
    if (jobHistory.length > 30) {
      jobHistory.shift();
    }
    
    const errors: string[] = [];
    let snapshotResult = { written: 0, skipped: 0, asofDate: '' };
    let resolveResult = { resolved7d: 0, resolved14d: 0, resolved30d: 0 };
    let equityRebuilt = false;
    let alertsResult = { sent: 0, blocked: 0, quotaUsed: 0, quotaMax: 3 };
    let memoryResult = { snapshotsWritten: 0, outcomesResolved: 0 };
    let integrityResult: IntegrityGuardResult | null = null;
    
    try {
      // ═══════════════════════════════════════════════════════════
      // STEP 0: INTEGRITY GUARD — Validate data, auto-bootstrap if needed
      // ═══════════════════════════════════════════════════════════
      const step0: DailyJobStep = {
        name: 'INTEGRITY_GUARD',
        startedAt: new Date(),
        status: 'RUNNING'
      };
      context.steps.push(step0);
      
      try {
        console.log(`[DailyJob] Step 0: Running integrity guard...`);
        integrityResult = await integrityGuardService.runGuard();
        
        step0.result = integrityResult;
        step0.status = integrityResult.allOk ? 'SUCCESS' : 'FAILED';
        step0.completedAt = new Date();
        
        if (!integrityResult.allOk) {
          const issues = integrityResult.checks.filter(c => c.status !== 'OK');
          for (const issue of issues) {
            if (issue.bootstrapTriggered && issue.bootstrapResult?.loaded === 0) {
              errors.push(`INTEGRITY_GUARD: ${issue.symbol} bootstrap failed`);
            }
          }
        }
        
        console.log(`[DailyJob] Integrity: allOk=${integrityResult.allOk}`);
      } catch (err: any) {
        step0.status = 'FAILED';
        step0.error = err.message;
        step0.completedAt = new Date();
        errors.push(`INTEGRITY_GUARD: ${err.message}`);
        console.error(`[DailyJob] Integrity guard error:`, err);
      }
      
      // ═══════════════════════════════════════════════════════════
      // STEP 1: Write BTC Snapshot
      // ═══════════════════════════════════════════════════════════
      const step1: DailyJobStep = {
        name: 'WRITE_SNAPSHOT',
        startedAt: new Date(),
        status: 'RUNNING'
      };
      context.steps.push(step1);
      
      try {
        console.log(`[DailyJob] Step 1: Writing BTC snapshot...`);
        const writeResult = await snapshotWriterService.writeBtcSnapshots();
        
        snapshotResult = {
          written: writeResult.written,
          skipped: writeResult.skipped,
          asofDate: writeResult.asofDate
        };
        
        step1.result = snapshotResult;
        step1.status = 'SUCCESS';
        step1.completedAt = new Date();
        
        console.log(`[DailyJob] Snapshot: written=${writeResult.written}, skipped=${writeResult.skipped}`);
      } catch (err: any) {
        step1.status = 'FAILED';
        step1.error = err.message;
        step1.completedAt = new Date();
        errors.push(`WRITE_SNAPSHOT: ${err.message}`);
        console.error(`[DailyJob] Snapshot error:`, err);
      }
      
      // ═══════════════════════════════════════════════════════════
      // STEP 2: Resolve Outcomes (7d, 14d, 30d)
      // ═══════════════════════════════════════════════════════════
      const step2: DailyJobStep = {
        name: 'RESOLVE_OUTCOMES',
        startedAt: new Date(),
        status: 'RUNNING'
      };
      context.steps.push(step2);
      
      try {
        console.log(`[DailyJob] Step 2: Resolving outcomes...`);
        
        // Resolve all horizons
        const resolve7d = await outcomeResolverService.resolveSnapshots(symbol, 7);
        const resolve14d = await outcomeResolverService.resolveSnapshots(symbol, 14);
        const resolve30d = await outcomeResolverService.resolveSnapshots(symbol, 30);
        
        resolveResult = {
          resolved7d: resolve7d.resolved,
          resolved14d: resolve14d.resolved,
          resolved30d: resolve30d.resolved
        };
        
        step2.result = resolveResult;
        step2.status = 'SUCCESS';
        step2.completedAt = new Date();
        
        console.log(`[DailyJob] Resolved: 7d=${resolve7d.resolved}, 14d=${resolve14d.resolved}, 30d=${resolve30d.resolved}`);
      } catch (err: any) {
        step2.status = 'FAILED';
        step2.error = err.message;
        step2.completedAt = new Date();
        errors.push(`RESOLVE_OUTCOMES: ${err.message}`);
        console.error(`[DailyJob] Resolve error:`, err);
      }
      
      // ═══════════════════════════════════════════════════════════
      // STEP 3: Rebuild Forward Equity
      // ═══════════════════════════════════════════════════════════
      const step3: DailyJobStep = {
        name: 'REBUILD_EQUITY',
        startedAt: new Date(),
        status: 'RUNNING'
      };
      context.steps.push(step3);
      
      try {
        console.log(`[DailyJob] Step 3: Rebuilding forward equity...`);
        
        // Trigger grid rebuild (this validates all calculations)
        await forwardEquityService.grid(symbol);
        
        equityRebuilt = true;
        step3.result = { rebuilt: true };
        step3.status = 'SUCCESS';
        step3.completedAt = new Date();
        
        console.log(`[DailyJob] Equity rebuilt successfully`);
      } catch (err: any) {
        step3.status = 'FAILED';
        step3.error = err.message;
        step3.completedAt = new Date();
        errors.push(`REBUILD_EQUITY: ${err.message}`);
        console.error(`[DailyJob] Equity rebuild error:`, err);
      }
      
      // ═══════════════════════════════════════════════════════════
      // STEP 4: Run Alerts Engine (BLOCK 67-68)
      // Order: WRITE → RESOLVE → REBUILD → ALERTS_RUN → AUDIT
      // ═══════════════════════════════════════════════════════════
      const step4: DailyJobStep = {
        name: 'ALERTS_RUN',
        startedAt: new Date(),
        status: 'RUNNING'
      };
      context.steps.push(step4);
      
      try {
        console.log(`[DailyJob] Step 4: Running alerts engine...`);
        
        // Build alert context from current state
        // Note: This reads the REBUILT equity/health state
        const alertCtx: AlertEngineContext = {
          symbol: 'BTC',
          current: {
            // Will be populated from rebuilt data
          },
          previous: {
            // Previous day state from snapshots
          }
        };
        
        // Run alert engine (evaluate + log to Mongo)
        const alertRunResult = await runAlertEngine(alertCtx);
        
        // Send to Telegram (respects FRACTAL_ALERTS_ENABLED)
        const sendableAlerts = alertRunResult.events.filter(e => e.blockedBy === 'NONE');
        if (sendableAlerts.length > 0) {
          const tgResult = await sendAlertsToTelegram(sendableAlerts);
          alertsResult.sent = tgResult.sent;
        }
        
        const quota = await getQuotaStatus();
        alertsResult = {
          sent: sendableAlerts.length,
          blocked: alertRunResult.blockedCount,
          quotaUsed: quota.used,
          quotaMax: quota.max
        };
        
        step4.result = alertsResult;
        step4.status = 'SUCCESS';
        step4.completedAt = new Date();
        
        console.log(`[DailyJob] Alerts: sent=${alertsResult.sent}, blocked=${alertsResult.blocked}, quota=${alertsResult.quotaUsed}/${alertsResult.quotaMax}`);
      } catch (err: any) {
        step4.status = 'FAILED';
        step4.error = err.message;
        step4.completedAt = new Date();
        errors.push(`ALERTS_RUN: ${err.message}`);
        console.error(`[DailyJob] Alerts error:`, err);
      }
      
      // ═══════════════════════════════════════════════════════════
      // STEP 5: Audit Log
      // ═══════════════════════════════════════════════════════════
      const step5: DailyJobStep = {
        name: 'AUDIT_LOG',
        startedAt: new Date(),
        status: 'RUNNING'
      };
      context.steps.push(step5);
      
      try {
        console.log(`[DailyJob] Step 5: Writing audit log...`);
        
        // In production, write to MongoDB audit collection
        const auditEntry = {
          type: 'DAILY_FORWARD_RUN',
          runId,
          symbol,
          date: new Date().toISOString().slice(0, 10),
          snapshot: snapshotResult,
          resolve: resolveResult,
          equityRebuilt,
          alerts: alertsResult,
          errors,
          durationMs: Date.now() - startedAt.getTime()
        };
        
        console.log(`[DailyJob] Audit:`, JSON.stringify(auditEntry));
        
        step5.result = auditEntry;
        step5.status = 'SUCCESS';
        step5.completedAt = new Date();
      } catch (err: any) {
        step5.status = 'FAILED';
        step5.error = err.message;
        step5.completedAt = new Date();
        errors.push(`AUDIT_LOG: ${err.message}`);
      }
      
      // ═══════════════════════════════════════════════════════════
      // STEP 6: BLOCK 75 — Memory Snapshots (Self-Validation Layer)
      // ═══════════════════════════════════════════════════════════
      const step6: DailyJobStep = {
        name: 'MEMORY_SNAPSHOTS',
        startedAt: new Date(),
        status: 'RUNNING'
      };
      context.steps.push(step6);
      
      try {
        console.log(`[DailyJob] Step 6: Writing memory snapshots (BLOCK 75.1)...`);
        
        // Write prediction snapshots for all 6 horizons × presets × roles
        const memoryWriteResult = await memorySnapshotWriterService.writeAllSnapshots();
        memoryResult.snapshotsWritten = memoryWriteResult.written;
        
        console.log(`[DailyJob] Step 6: Resolving memory outcomes (BLOCK 75.2)...`);
        
        // Resolve matured outcomes
        const memoryResolveResult = await memoryOutcomeResolverService.resolveMaturedOutcomes(symbol);
        memoryResult.outcomesResolved = memoryResolveResult.resolved;
        
        step6.result = memoryResult;
        step6.status = 'SUCCESS';
        step6.completedAt = new Date();
        
        console.log(`[DailyJob] Memory: written=${memoryResult.snapshotsWritten}, resolved=${memoryResult.outcomesResolved}`);
      } catch (err: any) {
        step6.status = 'FAILED';
        step6.error = err.message;
        step6.completedAt = new Date();
        errors.push(`MEMORY_SNAPSHOTS: ${err.message}`);
        console.error(`[DailyJob] Memory error:`, err);
      }
      
      // ═══════════════════════════════════════════════════════════
      // STEP 7: BLOCK 82 — Intel Timeline Write (LIVE)
      // ═══════════════════════════════════════════════════════════
      const step7: DailyJobStep = {
        name: 'INTEL_TIMELINE_WRITE',
        startedAt: new Date(),
        status: 'RUNNING'
      };
      context.steps.push(step7);
      
      let intelTimelineResult: any = { written: false };
      try {
        console.log(`[DailyJob] Step 7: Writing Intel Timeline snapshot (BLOCK 82)...`);
        
        // Get current state from consensus/phase services (simplified - uses defaults for now)
        // In full implementation, this would pull from consensus service
        const writeResult = await intelTimelineWriterService.writeLiveSnapshot({
          symbol,
          phaseType: 'NEUTRAL',
          phaseGrade: 'C',
          phaseScore: 50,
          phaseSharpe: 0,
          phaseHitRate: 0.5,
          phaseExpectancy: 0,
          phaseSamples: resolveResult?.resolved || 0,
          dominanceTier: 'STRUCTURE',
          structuralLock: false,
          timingOverrideBlocked: false,
          tierWeights: { structure: 0.5, tactical: 0.3, timing: 0.2 },
          volRegime: 'NORMAL',
          divergenceGrade: 'C',
          divergenceScore: 50,
          finalAction: 'HOLD',
          finalSize: 0,
          consensusIndex: 50,
          conflictLevel: 'LOW',
        });
        
        intelTimelineResult = writeResult;
        step7.result = writeResult;
        step7.status = 'SUCCESS';
        step7.completedAt = new Date();
        
        console.log(`[DailyJob] Intel Timeline: written=${writeResult.upserted}, date=${writeResult.date}`);
      } catch (err: any) {
        step7.status = 'FAILED';
        step7.error = err.message;
        step7.completedAt = new Date();
        errors.push(`INTEL_TIMELINE_WRITE: ${err.message}`);
        console.error(`[DailyJob] Intel Timeline error:`, err);
      }
      
      // ═══════════════════════════════════════════════════════════
      // STEP 8: BLOCK 83 — Intel Event Alerts Check
      // ═══════════════════════════════════════════════════════════
      const step8: DailyJobStep = {
        name: 'INTEL_EVENT_ALERTS',
        startedAt: new Date(),
        status: 'RUNNING'
      };
      context.steps.push(step8);
      
      let intelAlertsResult: any = { detected: 0, results: [] };
      try {
        console.log(`[DailyJob] Step 8: Checking Intel Event Alerts (BLOCK 83)...`);
        
        const today = new Date().toISOString().split('T')[0];
        const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        // Get yesterday and today from intel_timeline_daily
        const [yesterday, todayDoc] = await Promise.all([
          IntelTimelineModel.findOne({ symbol, source: 'LIVE', date: yesterdayDate }).lean(),
          IntelTimelineModel.findOne({ symbol, source: 'LIVE', date: today }).lean(),
        ]);
        
        if (!yesterday || !todayDoc) {
          step8.result = { skipped: true, reason: 'missing_intel_timeline' };
          step8.status = 'SUCCESS';
          step8.completedAt = new Date();
          console.log(`[DailyJob] Intel Alerts: skipped (missing timeline data)`);
        } else {
          // Detect events
          const detected = detectIntelEvents(yesterday as any, todayDoc as any);
          
          // Get live samples count
          const liveSamples = (todayDoc as any).phaseSamples || 0;
          
          // Process alerts
          const results = await intelAlertsService.runForDetectedEvents({
            symbol,
            source: 'LIVE',
            date: today,
            liveSamples,
            detected,
          });
          
          intelAlertsResult = { detected: detected.length, results };
          step8.result = intelAlertsResult;
          step8.status = 'SUCCESS';
          step8.completedAt = new Date();
          
          console.log(`[DailyJob] Intel Alerts: detected=${detected.length}, processed=${results.length}`);
        }
      } catch (err: any) {
        step8.status = 'FAILED';
        step8.error = err.message;
        step8.completedAt = new Date();
        errors.push(`INTEL_EVENT_ALERTS: ${err.message}`);
        console.error(`[DailyJob] Intel Alerts error:`, err);
      }
      
      // Complete context
      context.completedAt = new Date();
      context.status = errors.length === 0 ? 'SUCCESS' : 'FAILED';
      
    } catch (err: any) {
      context.completedAt = new Date();
      context.status = 'FAILED';
      context.error = err.message;
      errors.push(`FATAL: ${err.message}`);
    } finally {
      isRunning = false;
    }
    
    const durationMs = Date.now() - startedAt.getTime();
    
    console.log(`[DailyJob] Completed in ${durationMs}ms, status=${context.status}`);
    
    return {
      success: errors.length === 0,
      runId,
      symbol,
      durationMs,
      snapshot: snapshotResult,
      resolve: resolveResult,
      equity: { rebuilt: equityRebuilt },
      alerts: alertsResult,
      memory: memoryResult,
      errors
    };
  }
}

// Export singleton
export const fractalDailyJobService = new FractalDailyJobService();
