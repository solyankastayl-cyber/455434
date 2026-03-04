/**
 * DXY Daily Run Handler
 * 
 * D5.2 — Daily-run hook for DXY Forward Performance
 * 
 * Steps:
 * 1. Create snapshot (asOf=today)
 * 2. Resolve outcomes (что дозрело)
 * 3. Recompute metrics + equity cache
 * 
 * Guardrails:
 * - If DXY candles < MIN_REQUIRED → SKIP DXY, but daily-run doesn't fail
 * - If snapshot already exists → idempotent (upsert)
 * 
 * ISOLATION: DXY only. No BTC/SPX imports.
 */

import { Db } from 'mongodb';
import type { DailyRunContext } from './daily_run.types.js';

// Import DXY Forward services
import { createDxySnapshot, getDxySignalCount } from '../../dxy/forward/services/dxy_forward_snapshot.service.js';
import { resolveDxyOutcomes, getDxyOutcomeStats } from '../../dxy/forward/services/dxy_forward_outcome.service.js';
import { recomputeAllMetrics } from '../../dxy/forward/services/dxy_forward_metrics.service.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DXY_MIN_CANDLES = 1000;

// ═══════════════════════════════════════════════════════════════
// GUARDRAIL CHECK
// ═══════════════════════════════════════════════════════════════

async function checkDxyGuardrails(db: Db): Promise<{ ok: boolean; reason?: string; candleCount: number }> {
  const candleCount = await db.collection('dxy_candles').countDocuments();
  
  if (candleCount < DXY_MIN_CANDLES) {
    return {
      ok: false,
      reason: `DXY candles (${candleCount}) < MIN_REQUIRED (${DXY_MIN_CANDLES})`,
      candleCount,
    };
  }
  
  return { ok: true, candleCount };
}

// ═══════════════════════════════════════════════════════════════
// DXY FORWARD PERFORMANCE STEP
// ═══════════════════════════════════════════════════════════════

export interface DxyForwardPerfResult {
  ok: boolean;
  skipped: boolean;
  skipReason?: string;
  candleCount: number;
  snapshot: {
    created: number;
    errors: number;
  };
  outcomes: {
    resolved: number;
    skippedFuture: number;
    skippedExists: number;
  };
  metrics: {
    computed: number;
    cached: number;
  };
  signals: {
    total: number;
  };
  outcomes_stats: {
    total: number;
    resolved: number;
  };
}

/**
 * Run DXY Forward Performance daily step
 * 
 * 1. Check guardrails (candles >= MIN_REQUIRED)
 * 2. Create snapshot for today
 * 3. Resolve outcomes
 * 4. Recompute metrics
 */
export async function runDxyForwardPerf(db: Db, ctx: DailyRunContext): Promise<DxyForwardPerfResult> {
  // 1. Check guardrails
  const guardrailCheck = await checkDxyGuardrails(db);
  
  if (!guardrailCheck.ok) {
    ctx.warnings.push(`[DXY] Skipped: ${guardrailCheck.reason}`);
    ctx.logs.push(`[DXY] Forward Perf SKIPPED: ${guardrailCheck.reason}`);
    
    return {
      ok: true, // Step succeeds but is skipped
      skipped: true,
      skipReason: guardrailCheck.reason,
      candleCount: guardrailCheck.candleCount,
      snapshot: { created: 0, errors: 0 },
      outcomes: { resolved: 0, skippedFuture: 0, skippedExists: 0 },
      metrics: { computed: 0, cached: 0 },
      signals: { total: 0 },
      outcomes_stats: { total: 0, resolved: 0 },
    };
  }
  
  ctx.logs.push(`[DXY] Guardrails OK, candles: ${guardrailCheck.candleCount}`);
  
  // 2. Create snapshot for today
  const today = ctx.now.toISOString().slice(0, 10);
  ctx.logs.push(`[DXY] Creating snapshot for ${today}...`);
  
  const snapshotResult = await createDxySnapshot({ asOf: today });
  ctx.logs.push(`[DXY] Snapshot: created=${snapshotResult.createdCount}, errors=${snapshotResult.errors.length}`);
  
  // 3. Resolve outcomes
  ctx.logs.push(`[DXY] Resolving outcomes...`);
  
  const outcomeResult = await resolveDxyOutcomes(500);
  ctx.logs.push(`[DXY] Outcomes: resolved=${outcomeResult.resolved}, skippedFuture=${outcomeResult.skippedFuture}, skippedExists=${outcomeResult.skippedExists}`);
  
  // 4. Recompute metrics
  ctx.logs.push(`[DXY] Recomputing metrics...`);
  
  const metricsResult = await recomputeAllMetrics();
  ctx.logs.push(`[DXY] Metrics: computed=${metricsResult.computed}, cached=${metricsResult.cached}`);
  
  // 5. Get final counts
  const signalCount = await getDxySignalCount();
  const outcomeStats = await getDxyOutcomeStats();
  
  // Update context metrics
  ctx.metrics.dxySnapshotsWritten = snapshotResult.createdCount;
  ctx.metrics.dxyOutcomesResolved = outcomeResult.resolved;
  ctx.metrics.dxyMetricsCached = metricsResult.cached;
  
  return {
    ok: true,
    skipped: false,
    candleCount: guardrailCheck.candleCount,
    snapshot: {
      created: snapshotResult.createdCount,
      errors: snapshotResult.errors.length,
    },
    outcomes: {
      resolved: outcomeResult.resolved,
      skippedFuture: outcomeResult.skippedFuture,
      skippedExists: outcomeResult.skippedExists,
    },
    metrics: {
      computed: metricsResult.computed,
      cached: metricsResult.cached,
    },
    signals: {
      total: signalCount,
    },
    outcomes_stats: {
      total: outcomeStats.total,
      resolved: outcomeStats.resolved,
    },
  };
}
