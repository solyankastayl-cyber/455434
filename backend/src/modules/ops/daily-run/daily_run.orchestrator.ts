/**
 * L4.1 + L4.2 — Daily Run Orchestrator
 * 
 * Single orchestrator for daily pipeline.
 * Runs steps in strict order, captures lifecycle before/after.
 * L4.2: Auto Warmup Starter for PROD mode.
 */

import { Db } from 'mongodb';
import { 
  DailyRunContext, 
  DailyRunResponse, 
  DailyRunAsset, 
  DailyRunMode,
  DailyRunStepResult,
  DAILY_RUN_STEP_NAMES,
  DailyRunMetrics,
} from './daily_run.types.js';
import {
  getLifecycleSnapshot,
  runLiveSampleUpdate,
  runDriftCheck,
  runLifecycleHooks,
  runWarmupProgressWrite,
  runAutoPromote,
  runIntegrityGuard,
  runAutoWarmupStarter,
} from './daily_run.lifecycle.js';
import { runDxyForwardPerf } from './dxy_forward_perf.handler.js';

// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR CLASS
// ═══════════════════════════════════════════════════════════════

export class DailyRunOrchestrator {
  private db: Db;
  
  constructor(db: Db) {
    this.db = db;
  }
  
  /**
   * Generate unique run ID
   */
  private generateRunId(): string {
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  
  /**
   * Get system mode from lifecycle state
   */
  private async getSystemMode(asset: DailyRunAsset): Promise<DailyRunMode> {
    const state = await this.db.collection('model_lifecycle_state').findOne({ modelId: asset });
    return (state?.systemMode || 'DEV') as DailyRunMode;
  }
  
  /**
   * Run a single step with timing
   */
  private async runStep(
    stepName: typeof DAILY_RUN_STEP_NAMES[number],
    ctx: DailyRunContext,
    handler: () => Promise<Record<string, any>>
  ): Promise<DailyRunStepResult> {
    const startMs = Date.now();
    
    try {
      ctx.logs.push(`[Step] Starting ${stepName}...`);
      const details = await handler();
      const ms = Date.now() - startMs;
      
      ctx.logs.push(`[Step] ${stepName} completed in ${ms}ms`);
      
      return { name: stepName, ok: true, ms, details };
    } catch (err: any) {
      const ms = Date.now() - startMs;
      ctx.errors.push(`${stepName}: ${err.message}`);
      ctx.logs.push(`[Step] ${stepName} FAILED: ${err.message}`);
      
      return { name: stepName, ok: false, ms, error: err.message };
    }
  }
  
  /**
   * Main pipeline entry point
   */
  async runPipeline(asset: DailyRunAsset): Promise<DailyRunResponse> {
    const runId = this.generateRunId();
    const now = new Date();
    const mode = await this.getSystemMode(asset);
    
    // Initialize context
    const ctx: DailyRunContext = {
      runId,
      asset,
      mode,
      now,
      metrics: {},
      lifecycle: { before: null, after: null },
      logs: [],
      steps: [],
      warnings: [],
      errors: [],
    };
    
    const startMs = Date.now();
    
    ctx.logs.push(`[Pipeline] Starting daily-run for ${asset} in ${mode} mode`);
    
    // ═══════════════════════════════════════════════════════════
    // CAPTURE LIFECYCLE BEFORE
    // ═══════════════════════════════════════════════════════════
    ctx.lifecycle.before = await getLifecycleSnapshot(this.db, asset);
    ctx.logs.push(`[Pipeline] Lifecycle before: ${JSON.stringify(ctx.lifecycle.before)}`);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 1: SNAPSHOT_WRITE (placeholder - actual implementation in fractal module)
    // ═══════════════════════════════════════════════════════════
    const step1 = await this.runStep('SNAPSHOT_WRITE', ctx, async () => {
      // This would call snapshotWriterService.writeBtcSnapshots() or SPX equivalent
      // For now, we track metrics
      ctx.metrics.snapshotsWritten = 0;
      return { written: 0, skipped: 0, note: 'Delegated to asset-specific service' };
    });
    ctx.steps.push(step1);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 2: OUTCOME_RESOLVE (placeholder)
    // ═══════════════════════════════════════════════════════════
    const step2 = await this.runStep('OUTCOME_RESOLVE', ctx, async () => {
      // This would call outcomeResolverService.resolveSnapshots()
      ctx.metrics.outcomesResolved = 0;
      return { resolved: 0, note: 'Delegated to asset-specific service' };
    });
    ctx.steps.push(step2);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 2.5: FORWARD_PERF_DXY (D5.2 — DXY Forward Performance)
    // Only runs for DXY asset, but safe to call for BTC/SPX (returns skipped)
    // ═══════════════════════════════════════════════════════════
    const step2_5 = await this.runStep('FORWARD_PERF_DXY', ctx, async () => {
      if (asset !== 'DXY') {
        return { skipped: true, reason: `Asset is ${asset}, not DXY` };
      }
      return await runDxyForwardPerf(this.db, ctx);
    });
    ctx.steps.push(step2_5);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 3: LIVE_SAMPLE_UPDATE
    // ═══════════════════════════════════════════════════════════
    const step3 = await this.runStep('LIVE_SAMPLE_UPDATE', ctx, async () => {
      const resolved = ctx.metrics.outcomesResolved || 0;
      return await runLiveSampleUpdate(this.db, ctx, resolved);
    });
    ctx.steps.push(step3);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 4: DRIFT_CHECK
    // ═══════════════════════════════════════════════════════════
    const step4 = await this.runStep('DRIFT_CHECK', ctx, async () => {
      // Get current drift severity from drift engine
      // For now, preserve existing drift
      const currentState = await getLifecycleSnapshot(this.db, asset);
      const severity = currentState?.driftSeverity || 'OK';
      return await runDriftCheck(this.db, ctx, severity);
    });
    ctx.steps.push(step4);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 5: AUTO_WARMUP (L4.2)
    // ═══════════════════════════════════════════════════════════
    const step5 = await this.runStep('AUTO_WARMUP', ctx, async () => {
      return await runAutoWarmupStarter(this.db, ctx);
    });
    ctx.steps.push(step5);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 6: LIFECYCLE_HOOKS
    // ═══════════════════════════════════════════════════════════
    const step6 = await this.runStep('LIFECYCLE_HOOKS', ctx, async () => {
      return await runLifecycleHooks(this.db, ctx);
    });
    ctx.steps.push(step6);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 7: WARMUP_PROGRESS_WRITE
    // ═══════════════════════════════════════════════════════════
    const step7 = await this.runStep('WARMUP_PROGRESS_WRITE', ctx, async () => {
      return await runWarmupProgressWrite(this.db, ctx);
    });
    ctx.steps.push(step7);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 8: AUTO_PROMOTE
    // ═══════════════════════════════════════════════════════════
    const step8 = await this.runStep('AUTO_PROMOTE', ctx, async () => {
      return await runAutoPromote(this.db, ctx);
    });
    ctx.steps.push(step8);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 9: INTEL_TIMELINE_WRITE (placeholder)
    // ═══════════════════════════════════════════════════════════
    const step9 = await this.runStep('INTEL_TIMELINE_WRITE', ctx, async () => {
      return { written: false, note: 'Delegated to intel module' };
    });
    ctx.steps.push(step9);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 10: ALERTS_DISPATCH (placeholder)
    // ═══════════════════════════════════════════════════════════
    const step10 = await this.runStep('ALERTS_DISPATCH', ctx, async () => {
      return { sent: 0, blocked: 0, note: 'Delegated to alerts module' };
    });
    ctx.steps.push(step10);
    
    // ═══════════════════════════════════════════════════════════
    // STEP 11: INTEGRITY_GUARD
    // ═══════════════════════════════════════════════════════════
    const step11 = await this.runStep('INTEGRITY_GUARD', ctx, async () => {
      return await runIntegrityGuard(this.db, ctx);
    });
    ctx.steps.push(step11);
    
    // ═══════════════════════════════════════════════════════════
    // CAPTURE LIFECYCLE AFTER
    // ═══════════════════════════════════════════════════════════
    ctx.lifecycle.after = await getLifecycleSnapshot(this.db, asset);
    ctx.logs.push(`[Pipeline] Lifecycle after: ${JSON.stringify(ctx.lifecycle.after)}`);
    
    // Determine transition
    const transition = ctx.lifecycle.before?.status !== ctx.lifecycle.after?.status
      ? `${ctx.lifecycle.before?.status || 'UNKNOWN'} → ${ctx.lifecycle.after?.status || 'UNKNOWN'}`
      : null;
    
    if (transition) {
      ctx.metrics.statusTransition = transition;
      ctx.logs.push(`[Pipeline] Status transition detected: ${transition}`);
    }
    
    const durationMs = Date.now() - startMs;
    const ok = ctx.errors.length === 0;
    
    ctx.logs.push(`[Pipeline] Completed in ${durationMs}ms, ok=${ok}`);
    
    // ═══════════════════════════════════════════════════════════
    // LOG EVENT
    // ═══════════════════════════════════════════════════════════
    await this.db.collection('model_lifecycle_events').insertOne({
      modelId: asset,
      engineVersion: 'v2.1',
      ts: now.toISOString(),
      type: 'DAILY_RUN_COMPLETED',
      actor: 'SYSTEM',
      meta: {
        runId,
        durationMs,
        ok,
        stepsOk: ctx.steps.filter(s => s.ok).length,
        stepsTotal: ctx.steps.length,
        transition,
        warnings: ctx.warnings,
        errors: ctx.errors,
      },
    });
    
    // Build response
    return {
      ok,
      runId,
      asset,
      mode,
      durationMs,
      steps: ctx.steps,
      lifecycle: {
        before: ctx.lifecycle.before,
        after: ctx.lifecycle.after,
        transition,
      },
      metrics: ctx.metrics as DailyRunMetrics,
      warnings: ctx.warnings,
      errors: ctx.errors,
    };
  }
}

// Singleton factory
let orchestratorInstance: DailyRunOrchestrator | null = null;

export function getDailyRunOrchestrator(db: Db): DailyRunOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new DailyRunOrchestrator(db);
  }
  return orchestratorInstance;
}

console.log('[DailyRun] Orchestrator loaded (L4.1)');
