/**
 * L4.1 — Daily Run Types
 * 
 * Unified types for daily pipeline orchestration
 */

// ═══════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════

export type DailyRunAsset = 'BTC' | 'SPX' | 'DXY';
export type DailyRunMode = 'DEV' | 'PROD';

export const DAILY_RUN_STEP_NAMES = [
  'SNAPSHOT_WRITE',
  'OUTCOME_RESOLVE',
  'FORWARD_PERF_DXY',
  'LIVE_SAMPLE_UPDATE',
  'DRIFT_CHECK',
  'AUTO_WARMUP',
  'LIFECYCLE_HOOKS',
  'WARMUP_PROGRESS_WRITE',
  'AUTO_PROMOTE',
  'INTEL_TIMELINE_WRITE',
  'ALERTS_DISPATCH',
  'INTEGRITY_GUARD',
] as const;

export type DailyRunStepName = typeof DAILY_RUN_STEP_NAMES[number];

// ═══════════════════════════════════════════════════════════════
// STEP RESULT
// ═══════════════════════════════════════════════════════════════

export interface DailyRunStepResult {
  name: DailyRunStepName;
  ok: boolean;
  ms: number;
  details?: Record<string, any>;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// LIFECYCLE STATE (before/after)
// ═══════════════════════════════════════════════════════════════

export interface LifecycleSnapshot {
  status: string;
  systemMode: string;
  liveSamples: number;
  warmupProgress: number;
  driftSeverity: string;
  constitutionHash: string | null;
}

// ═══════════════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════════════

export interface DailyRunMetrics {
  snapshotsWritten: number;
  outcomesResolved: number;
  liveSamplesBefore: number;
  liveSamplesAfter: number;
  driftSeverity: string;
  warmupProgressBefore: number;
  warmupProgressAfter: number;
  constitutionHash: string | null;
  statusTransition: string | null; // e.g., "WARMUP → APPLIED" or null
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT (passed through pipeline)
// ═══════════════════════════════════════════════════════════════

export interface DailyRunContext {
  runId: string;
  asset: DailyRunAsset;
  mode: DailyRunMode;
  now: Date;
  
  // Metrics collected during run
  metrics: Partial<DailyRunMetrics>;
  
  // Lifecycle state tracking
  lifecycle: {
    before: LifecycleSnapshot | null;
    after: LifecycleSnapshot | null;
  };
  
  // Logs for debugging
  logs: string[];
  
  // Step results
  steps: DailyRunStepResult[];
  
  // Warnings (non-fatal)
  warnings: string[];
  
  // Errors (fatal for that step)
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface DailyRunResponse {
  ok: boolean;
  runId: string;
  asset: DailyRunAsset;
  mode: DailyRunMode;
  durationMs: number;
  
  steps: DailyRunStepResult[];
  
  lifecycle: {
    before: LifecycleSnapshot | null;
    after: LifecycleSnapshot | null;
    transition: string | null;
  };
  
  metrics: DailyRunMetrics;
  
  warnings: string[];
  errors: string[];
}

console.log('[DailyRun] Types loaded (L4.1)');
