/**
 * ML Data Jobs Scheduler
 * 
 * Scheduled jobs for data accumulation
 * RESPECTS System Settings: Jobs only run when ML Advisor is enabled
 */
import { runDecisionSnapshot, backfillOutcomes } from '../core/ml_data/index.js';
import { computeAllRankings } from '../core/rankings_v2/rankings_v2.service.js';
import { EngineRuntimeConfigModel } from '../core/engine/engine_runtime_config.model.js';
import type { EngineWindow } from '../core/engine_v2/signals_fetcher.js';

// Job state
let isSnapshotRunning = false;
let isBackfillRunning = false;
let isRankingsRunning = false;

// Intervals (in ms)
const SNAPSHOT_INTERVAL = 15 * 60 * 1000;    // 15 minutes
const BACKFILL_INTERVAL = 10 * 60 * 1000;    // 10 minutes
const RANKINGS_INTERVAL = 30 * 60 * 1000;    // 30 minutes

/**
 * Check if ML Data collection is enabled based on settings
 */
async function isMLDataCollectionEnabled(): Promise<boolean> {
  try {
    const config = await EngineRuntimeConfigModel.findOne().lean();
    if (!config) return false;
    
    // Data collection enabled only if ML mode is 'advisor' or 'assist'
    return config.mlMode === 'advisor' || config.mlMode === 'assist';
  } catch (error) {
    console.error('[MLDataJobs] Error checking settings:', error);
    return false;
  }
}

/**
 * Check if Rankings snapshots are enabled
 * For now, follows ML mode (can be separated later)
 */
async function isRankingsSnapshotEnabled(): Promise<boolean> {
  try {
    const config = await EngineRuntimeConfigModel.findOne().lean();
    if (!config) return false;
    
    // Rankings snapshots follow ML mode
    return config.mlMode !== 'off';
  } catch (error) {
    console.error('[MLDataJobs] Error checking settings:', error);
    return false;
  }
}

/**
 * Decision Snapshot Job
 * Logs Engine V2 decisions for top tokens
 * GATED BY: mlMode !== 'off'
 */
export async function decisionSnapshotJob(): Promise<void> {
  if (isSnapshotRunning) {
    console.log('[Job:DecisionSnapshot] Already running, skipping');
    return;
  }
  
  // Check settings first
  const enabled = await isMLDataCollectionEnabled();
  if (!enabled) {
    console.log('[Job:DecisionSnapshot] Skipped - ML Advisor is OFF');
    return;
  }
  
  isSnapshotRunning = true;
  console.log('[Job:DecisionSnapshot] Starting...');
  
  try {
    const result = await runDecisionSnapshot('24h', 50);
    console.log(`[Job:DecisionSnapshot] Complete: logged=${result.logged}, errors=${result.errors}`);
  } catch (error) {
    console.error('[Job:DecisionSnapshot] Error:', error);
  } finally {
    isSnapshotRunning = false;
  }
}

/**
 * Outcome Backfill Job
 * Fills in price outcomes for past decisions
 * GATED BY: mlMode !== 'off'
 */
export async function outcomeBackfillJob(): Promise<void> {
  if (isBackfillRunning) {
    console.log('[Job:OutcomeBackfill] Already running, skipping');
    return;
  }
  
  // Check settings first
  const enabled = await isMLDataCollectionEnabled();
  if (!enabled) {
    console.log('[Job:OutcomeBackfill] Skipped - ML Advisor is OFF');
    return;
  }
  
  isBackfillRunning = true;
  console.log('[Job:OutcomeBackfill] Starting...');
  
  try {
    const result = await backfillOutcomes(100);
    console.log(`[Job:OutcomeBackfill] Complete: updated=${result.updated}, errors=${result.errors}`);
  } catch (error) {
    console.error('[Job:OutcomeBackfill] Error:', error);
  } finally {
    isBackfillRunning = false;
  }
}

/**
 * Rankings Snapshot Job
 * Computes and stores Rankings V2
 * GATED BY: mlMode !== 'off'
 */
export async function rankingsSnapshotJob(): Promise<void> {
  if (isRankingsRunning) {
    console.log('[Job:RankingsSnapshot] Already running, skipping');
    return;
  }
  
  // Check settings first
  const enabled = await isRankingsSnapshotEnabled();
  if (!enabled) {
    console.log('[Job:RankingsSnapshot] Skipped - Rankings snapshots disabled');
    return;
  }
  
  isRankingsRunning = true;
  console.log('[Job:RankingsSnapshot] Starting...');
  
  try {
    const result = await computeAllRankings('24h', 100);
    console.log(`[Job:RankingsSnapshot] Complete: total=${result.summary.total}`);
  } catch (error) {
    console.error('[Job:RankingsSnapshot] Error:', error);
  } finally {
    isRankingsRunning = false;
  }
}

// Interval handles
let snapshotInterval: NodeJS.Timeout | null = null;
let backfillInterval: NodeJS.Timeout | null = null;
let rankingsInterval: NodeJS.Timeout | null = null;

/**
 * Start all ML data jobs
 * Jobs will check settings on each run - they don't need to be restarted when settings change
 */
export function startMLDataJobs(): void {
  console.log('[MLDataJobs] Starting scheduled jobs (settings-controlled)...');
  
  // Initial run after 2 minutes (gives time for settings to load)
  setTimeout(() => {
    decisionSnapshotJob();
    outcomeBackfillJob();
    rankingsSnapshotJob();
  }, 2 * 60 * 1000);
  
  // Set up intervals (jobs check settings on each run)
  snapshotInterval = setInterval(decisionSnapshotJob, SNAPSHOT_INTERVAL);
  backfillInterval = setInterval(outcomeBackfillJob, BACKFILL_INTERVAL);
  rankingsInterval = setInterval(rankingsSnapshotJob, RANKINGS_INTERVAL);
  
  console.log('[MLDataJobs] Scheduled jobs registered (gated by ML Advisor settings)');
  console.log(`  - Decision Snapshot: every ${SNAPSHOT_INTERVAL / 60000} min (when ML mode != off)`);
  console.log(`  - Outcome Backfill: every ${BACKFILL_INTERVAL / 60000} min (when ML mode != off)`);
  console.log(`  - Rankings Snapshot: every ${RANKINGS_INTERVAL / 60000} min (when ML mode != off)`);
}

/**
 * Stop all ML data jobs
 */
export function stopMLDataJobs(): void {
  console.log('[MLDataJobs] Stopping scheduled jobs...');
  
  if (snapshotInterval) clearInterval(snapshotInterval);
  if (backfillInterval) clearInterval(backfillInterval);
  if (rankingsInterval) clearInterval(rankingsInterval);
  
  snapshotInterval = null;
  backfillInterval = null;
  rankingsInterval = null;
  
  console.log('[MLDataJobs] Scheduled jobs stopped');
}

/**
 * Get job status
 */
export async function getJobStatus(): Promise<{
  mlCollectionEnabled: boolean;
  rankingsEnabled: boolean;
  snapshotRunning: boolean;
  backfillRunning: boolean;
  rankingsRunning: boolean;
  intervals: {
    snapshot: number;
    backfill: number;
    rankings: number;
  };
}> {
  const mlEnabled = await isMLDataCollectionEnabled();
  const rankingsEnabled = await isRankingsSnapshotEnabled();
  
  return {
    mlCollectionEnabled: mlEnabled,
    rankingsEnabled: rankingsEnabled,
    snapshotRunning: isSnapshotRunning,
    backfillRunning: isBackfillRunning,
    rankingsRunning: isRankingsRunning,
    intervals: {
      snapshot: SNAPSHOT_INTERVAL,
      backfill: BACKFILL_INTERVAL,
      rankings: RANKINGS_INTERVAL,
    },
  };
}
