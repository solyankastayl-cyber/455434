/**
 * Fractal Module Entry Point - PRODUCTION
 * V2.1 FINAL Architecture
 * 
 * BLOCK 41.x: Certification Suite
 * BLOCK 42.x: Module Isolation
 * BLOCK 43.x: Hardening + Persistence
 * BLOCK 47.x: Catastrophic Guard + Degeneration Monitor
 * BLOCK 48.x: Admin Decision Playbooks
 * BLOCK 49.x: Admin Aggregator Dashboard
 * 
 * CONTRACT FROZEN — Horizons: 7d / 14d / 30d
 */

import { FastifyInstance } from 'fastify';
import { fractalRoutes } from '../api/fractal.routes.js';
import { fractalCertRoutes } from '../api/fractal.cert.routes.js';
import { fractalV21AdminRoutes } from '../api/fractal.v21.admin.routes.js';
import { fractalSignalRoutes } from '../api/fractal.signal.routes.js';
import { fractalChartRoutes } from '../api/fractal.chart.routes.js';
import { fractalOverlayRoutes } from '../api/fractal.overlay.routes.js';
import { fractalStrategyRoutes } from '../api/fractal.strategy.routes.js';
import { strategyBacktestRoutes } from '../strategy/strategy.backtest.routes.js';
import { forwardEquityRoutes } from '../strategy/forward/forward.routes.js';
import { testSnapshotRoutes } from '../strategy/forward/test-snapshot.routes.js';
import { snapshotWriterRoutes } from '../lifecycle/snapshot.writer.routes.js';
import { outcomeResolverRoutes } from '../lifecycle/outcome.resolver.routes.js';
import { fractalJobRoutes } from '../jobs/fractal.job.routes.js';
import { shadowDivergenceRoutes } from '../admin/shadow_divergence.routes.js';
import { registerOpsRoutes } from '../ops/ops.routes.js';
import { registerHardenedOpsRoutes } from '../ops/ops.hardened.routes.js';
import { registerFreezeRoutes } from '../freeze/fractal.freeze.routes.js';
import { FractalBootstrapService } from '../bootstrap/fractal.bootstrap.service.js';
import { guardRoutes, playbookRoutes, governanceLockRoutes } from '../governance/index.js';
import { adminOverviewRoutes } from '../admin/dashboard/index.js';
import { phasePerformanceRoutes } from '../admin/dashboard/phase-performance.routes.js';
import { fractalMultiSignalRoutes } from '../api/fractal.multi-signal.routes.js';
import { fractalRegimeRoutes } from '../api/fractal.regime.routes.js';
import { fractalTerminalRoutes } from '../api/fractal.terminal.routes.js';
import { registerVolatilityRoutes } from '../api/fractal.volatility.routes.js';
import { registerAlertRoutes } from '../alerts/index.js';
import { focusPackRoutes } from '../focus/focus.routes.js';
import { memoryRoutes } from '../memory/memory.routes.js';
import { attributionRoutes } from '../memory/attribution/attribution.routes.js';
import { consensusPulseRoutes } from '../pulse/consensus-pulse.routes.js';
import { learningRoutes } from '../learning/index.js';
import { bootstrapRoutes, institutionalBackfillRoutes } from '../bootstrap/index.js';
import { driftRoutes, driftAlertRoutes, consensusTimelineRoutes, driftIntelligenceRoutes } from '../drift/index.js';
import { proposalRoutes } from '../proposal/index.js';
import { schedulerRoutes } from '../ops/scheduler/index.js';
import { registerIntelTimelineRoutes } from '../intel-timeline/index.js';
import { registerIntelAlertsRoutes } from '../intel-alerts/index.js';
import { registerModelHealthRoutes } from '../model-health/index.js';
import registerAuditRoutes from '../audit/audit.routes.js';
import registerMacroScoreV3Routes from '../../macro-score-v3/macro_score.routes.js';
import { registerL5AuditRoutes } from '../../audit/l5_final_audit.js';

// ═══════════════════════════════════════════════════════════════
// BLOCK 42.1 — Host Dependencies Contract
// ═══════════════════════════════════════════════════════════════

export type Logger = {
  info: (obj: any, msg?: string) => void;
  warn: (obj: any, msg?: string) => void;
  error: (obj: any, msg?: string) => void;
};

export type Clock = {
  now: () => number; // ms epoch
};

export type Db = {
  getCollection: (name: string) => any; // mongodb collection or adapter
};

export type Settings = {
  get: (key: string) => any;
  getBool: (key: string, def?: boolean) => boolean;
  getNum: (key: string, def?: number) => number;
  getStr: (key: string, def?: string) => string;
};

export type FractalHostDeps = {
  app: FastifyInstance;
  logger?: Logger;
  clock?: Clock;
  db?: Db;
  settings?: Settings;
};

// ═══════════════════════════════════════════════════════════════
// MODULE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerFractalModule(fastify: FastifyInstance, deps?: Partial<FractalHostDeps>): Promise<void> {
  const enabled = process.env.FRACTAL_ENABLED !== 'false';

  console.log(`[Fractal] Module ${enabled ? 'ENABLED' : 'DISABLED'}`);

  if (!enabled) {
    // Register minimal health endpoint even when disabled
    fastify.get('/api/fractal/health', async () => ({
      ok: true,
      enabled: false,
      message: 'Fractal module is disabled'
    }));
    return;
  }

  // Register main routes
  await fastify.register(fractalRoutes);

  // Register V2.1 FINAL signal endpoint (FROZEN CONTRACT)
  await fastify.register(fractalSignalRoutes);

  // Register V2.1 chart data endpoint (for UI)
  await fastify.register(fractalChartRoutes);

  // Register V2.1 overlay data endpoint (for Fractal Overlay UI)
  await fastify.register(fractalOverlayRoutes);

  // Register V2.1 strategy endpoint (BLOCK 54 - Strategy Engine)
  await fastify.register(fractalStrategyRoutes);

  // Register V2.1 strategy backtest endpoint (BLOCK 56 - Backtest Grid)
  await fastify.register(strategyBacktestRoutes);

  // Register Forward Equity routes (BLOCK 56.4 - Forward Truth Performance)
  await fastify.register(forwardEquityRoutes);
  
  // Register Test Snapshot routes (BLOCK 56.6 - Test Data Generation)
  await fastify.register(testSnapshotRoutes);

  // Register certification routes (BLOCK 41.x)
  await fastify.register(fractalCertRoutes);

  // Register V2.1 admin routes (BLOCK 43.x)
  await fastify.register(fractalV21AdminRoutes);

  // Register Guard routes (BLOCK 47.x)
  await fastify.register(guardRoutes);

  // Register Playbook routes (BLOCK 48.x)
  await fastify.register(playbookRoutes);

  // Register Admin Overview routes (BLOCK 49.x)
  await fastify.register(adminOverviewRoutes);

  // Register Phase Performance routes (BLOCK 73.6)
  await fastify.register(phasePerformanceRoutes);

  // Register Snapshot Writer routes (BLOCK 56.2 - Lifecycle)
  await fastify.register(snapshotWriterRoutes);

  // Register Outcome Resolver routes (BLOCK 56.3 - Forward Truth)
  await fastify.register(outcomeResolverRoutes);

  // Register Daily Job routes (BLOCK 56.6 - Scheduler)
  await fastify.register(fractalJobRoutes);

  // Register Shadow Divergence routes (BLOCK 57 - Active vs Shadow)
  await fastify.register(shadowDivergenceRoutes);

  // Register OPS routes (Telegram + Cron - Production Infrastructure)
  await fastify.register(registerOpsRoutes);

  // Register Hardened OPS routes (BLOCK E - Telegram + Cron Hardening)
  await fastify.register(registerHardenedOpsRoutes);

  // Register Freeze routes (Contract Freeze Pack v1.0.0)
  await fastify.register(registerFreezeRoutes);

  // BLOCK 58/59 — Multi-Signal Extended (all horizons + hierarchical resolver)
  await fastify.register(fractalMultiSignalRoutes);

  // BLOCK 59.1 — Global Regime Panel
  await fastify.register(fractalRegimeRoutes);

  // PHASE 2 P0.1 — Terminal Aggregator (one request → entire terminal)
  await fastify.register(fractalTerminalRoutes);

  // P1.5 — Volatility Attribution (performance by regime)
  await fastify.register(registerVolatilityRoutes);

  // BLOCK 67-68 — Regime Alert System
  await fastify.register(registerAlertRoutes);

  // BLOCK 70.2 — FocusPack (Real Horizon Binding)
  await fastify.register(focusPackRoutes);

  // BLOCK 75.1 & 75.2 — Memory & Self-Validation Layer
  await fastify.register(memoryRoutes);

  // BLOCK 75.3 & 75.4 — Attribution & Policy Governance
  await fastify.register(attributionRoutes);

  // BLOCK 76.1 & 76.2 — Consensus Pulse + Weekly Digest
  await fastify.register(consensusPulseRoutes);
  
  // BLOCK 76.2.2 — Start Weekly Cron Scheduler
  try {
    const { startWeeklyCron } = await import('../pulse/weekly-cron.scheduler.js');
    startWeeklyCron();
  } catch (err) {
    console.error('[Fractal] Failed to start weekly cron:', err);
  }
  
  // BLOCK 77 — Adaptive Weight Learning
  await fastify.register(learningRoutes);
  
  // BLOCK 77.4 — Historical Bootstrap Engine
  await fastify.register(bootstrapRoutes);
  
  // BLOCK 77.5 — Institutional Full Backfill (2020-2025)
  await fastify.register(institutionalBackfillRoutes);
  
  // BLOCK 78 — Drift Intelligence (Cohort Comparison)
  await fastify.register(driftRoutes);
  
  // BLOCK 80.2 — Drift Alerts (TG Integration)
  await fastify.register(driftAlertRoutes);
  
  // BLOCK 80.3 — Consensus Timeline (30d)
  await fastify.register(consensusTimelineRoutes);
  
  // BLOCK 78.5 — Governance Lock (LIVE-only APPLY)
  await fastify.register(governanceLockRoutes);
  
  // BLOCK 79 — Proposal Persistence + Audit Trail
  await fastify.register(proposalRoutes);
  
  // BLOCK 80.1 — Daily Run Scheduler Control
  await fastify.register(schedulerRoutes);
  
  // BLOCK 81 — Drift Intelligence (LIVE vs V2014/V2020)
  await fastify.register(driftIntelligenceRoutes);
  
  // BLOCK 82 — Intel Timeline (Phase Strength + Dominance History)
  await fastify.register(registerIntelTimelineRoutes);
  
  // BLOCK 83 — Intel Alerts (Event-based alerts)
  await fastify.register(registerIntelAlertsRoutes);
  
  // BLOCK 85 — Model Health Composite Score
  await fastify.register(registerModelHealthRoutes);
  
  // L2/L3 AUDIT — Invariant Tests + Horizon Consistency
  await registerAuditRoutes(fastify);
  console.log('[Fractal] L2/L3 Audit Module registered at /api/audit/*');
  
  // MacroScore V3 — Deep Math Audit
  await registerMacroScoreV3Routes(fastify);
  console.log('[Fractal] MacroScore V3 registered at /api/macro-score/v3/*');
  
  // L5 Final Audit Suite
  await registerL5AuditRoutes(fastify);
  console.log('[Fractal] L5 Final Audit registered at /api/audit/l5/*');
  
  // Overview UI Aggregator
  const { registerOverviewRoutes } = await import('../../overview/overview.service.js');
  await registerOverviewRoutes(fastify);
  console.log('[Fractal] Overview UI registered at /api/ui/overview');
  
  // Prediction Snapshots (History Layer)
  const { registerPredictionRoutes } = await import('../../prediction/prediction_snapshots.service.js');
  await registerPredictionRoutes(fastify);
  console.log('[Fractal] Prediction Snapshots registered at /api/prediction/*');
  
  // Backtest Runner
  const { default: registerBacktestRoutes } = await import('../../backtest/backtest.routes.js');
  await registerBacktestRoutes(fastify);
  console.log('[Fractal] Backtest Runner registered at /api/backtest/*');
  
  // Data Ingestion Routes (FRED → MongoDB)
  const { default: registerIngestionRoutes } = await import('../../macro-score-v3/data/ingestion.routes.js');
  await registerIngestionRoutes(fastify);
  console.log('[Fractal] Data Ingestion registered at /api/data/*');

  // Run bootstrap in background (non-blocking)
  const bootstrap = new FractalBootstrapService();
  bootstrap.ensureBootstrapped().catch(err => {
    console.error('[Fractal] Background bootstrap error:', err);
  });

  console.log('[Fractal] V2.1 FINAL — Module registered (Contract Frozen: 7d/14d/30d)');
  console.log('[Fractal] BLOCK 47-49: Guard + Playbook + Overview registered');
  console.log('[Fractal] BLOCK 56: Strategy Backtest Grid registered');
  console.log('[Fractal] BLOCK 56.2: Snapshot Writer registered');
  console.log('[Fractal] BLOCK 56.3: Outcome Resolver registered');
  console.log('[Fractal] BLOCK 56.4: Forward Equity registered');
  console.log('[Fractal] BLOCK 56.6: Daily Job Scheduler registered');
  console.log('[Fractal] BLOCK 57: Shadow Divergence registered');
  console.log('[Fractal] OPS: Telegram + Cron routes registered');
  console.log('[Fractal] BLOCK E: Hardened OPS (rate limit, retry, idempotency) registered');
  console.log('[Fractal] BLOCK 70.2: FocusPack (Real Horizon Binding) registered');
  console.log('[Fractal] BLOCK 58: Hierarchical Resolver (Bias + Timing + Final) registered');
  console.log('[Fractal] BLOCK 59: Extended Horizons (90d/180d/365d) registered');
  console.log('[Fractal] BLOCK 59.1: Global Regime Panel registered');
  console.log('[Fractal] PHASE 2 P0.1: Terminal Aggregator registered');
  console.log('[Fractal] P1.5: Volatility Attribution registered');
  console.log('[Fractal] BLOCK 67-68: Alert System registered');
  console.log('[Fractal] BLOCK 75.1: Memory Snapshot Persistence registered');
  console.log('[Fractal] BLOCK 75.2: Forward Truth Outcome Resolver registered');
  console.log('[Fractal] BLOCK 75.3: Attribution Service registered');
  console.log('[Fractal] BLOCK 75.4: Policy Governance registered');
  console.log('[Fractal] BLOCK 76.1: Consensus Pulse registered');
  console.log('[Fractal] BLOCK 76.2: Weekly Digest registered');
  console.log('[Fractal] BLOCK 77: Adaptive Weight Learning registered');
  console.log('[Fractal] BLOCK 77.5: Institutional Backfill (2020-2025) registered');
  console.log('[Fractal] BLOCK 78: Drift Intelligence (LIVE vs V2014 vs V2020) registered');
  console.log('[Fractal] BLOCK 80.2: Drift Alerts (TG Integration) registered');
  console.log('[Fractal] BLOCK 80.3: Consensus Timeline (30d) registered');
  console.log('[Fractal] BLOCK 78.5: Governance Lock (LIVE-only APPLY) registered');
  console.log('[Fractal] BLOCK 79: Proposal Persistence + Audit Trail registered');
  console.log('[Fractal] BLOCK 80.1: Daily Run Scheduler Control registered');
  console.log('[Fractal] BLOCK 81: Drift Intelligence (LIVE vs V2014/V2020) registered');
  console.log('[Fractal] BLOCK 82: Intel Timeline (Phase Strength + Dominance History) registered');
  console.log('[Fractal] BLOCK 83: Intel Alerts (Event-based alerts) registered');
  console.log('[Fractal] BLOCK 85: Model Health Composite Score registered');
  console.log('[Fractal] FREEZE: Contract v2.1.0 frozen, guards active');
  console.log('[Fractal] Chart + Overlay endpoints registered');
}
