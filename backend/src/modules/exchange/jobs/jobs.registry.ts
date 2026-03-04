/**
 * Y1 — Jobs Registry
 * ===================
 * 
 * Central registry for Exchange ingestion jobs.
 * Manages job lifecycle: start, stop, config, run-once.
 */

import {
  JobId,
  JobDefinition,
  JobState,
  JobRuntimeConfig,
  JobExecutionResult,
  JobStatus,
} from './jobs.types.js';

// ═══════════════════════════════════════════════════════════════
// REGISTRY STATE
// ═══════════════════════════════════════════════════════════════

const jobDefinitions = new Map<JobId, JobDefinition>();
const jobStates = new Map<JobId, JobState>();

// ═══════════════════════════════════════════════════════════════
// DEFAULT JOB DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

function initializeDefaultJobs(): void {
  // Exchange Tick Job
  registerJobDefinition({
    id: 'exchangeTick',
    displayName: 'Exchange Tick',
    description: 'Fetches market data from providers (candles, orderbook, trades)',
    defaultScheduleMs: 30000,
    defaultSymbols: DEFAULT_SYMBOLS,
    handler: async (config) => {
      // Placeholder - actual implementation in exchange-data.service
      return { ok: true, executionMs: 0, processedCount: config.trackedSymbols.length };
    },
  });

  // Whale Ingest Job
  registerJobDefinition({
    id: 'whaleIngest',
    displayName: 'Whale Ingest',
    description: 'Monitors whale wallet activities and large transactions',
    defaultScheduleMs: 60000,
    defaultSymbols: DEFAULT_SYMBOLS,
    handler: async (config) => {
      return { ok: true, executionMs: 0, processedCount: 0 };
    },
  });

  // Indicator Calculation Job
  registerJobDefinition({
    id: 'indicatorCalculation',
    displayName: 'Indicator Calculation',
    description: 'Calculates 32 market indicators from snapshots',
    defaultScheduleMs: 60000,
    defaultSymbols: DEFAULT_SYMBOLS,
    handler: async (config) => {
      return { ok: true, executionMs: 0, processedCount: 32 };
    },
  });

  // Regime Detection Job
  registerJobDefinition({
    id: 'regimeDetection',
    displayName: 'Regime Detection',
    description: 'Detects market regimes (ACCUMULATION, DISTRIBUTION, etc.)',
    defaultScheduleMs: 60000,
    defaultSymbols: DEFAULT_SYMBOLS,
    handler: async (config) => {
      return { ok: true, executionMs: 0, processedCount: config.trackedSymbols.length };
    },
  });

  // Pattern Detection Job
  registerJobDefinition({
    id: 'patternDetection',
    displayName: 'Pattern Detection',
    description: 'Detects market patterns (ABSORPTION_TRAP, EXHAUSTION, etc.)',
    defaultScheduleMs: 60000,
    defaultSymbols: DEFAULT_SYMBOLS,
    handler: async (config) => {
      return { ok: true, executionMs: 0, processedCount: config.trackedSymbols.length };
    },
  });

  // Observation Persist Job
  registerJobDefinition({
    id: 'observationPersist',
    displayName: 'Observation Persist',
    description: 'Persists observation rows to database',
    defaultScheduleMs: 60000,
    defaultSymbols: DEFAULT_SYMBOLS,
    handler: async (config) => {
      return { ok: true, executionMs: 0, processedCount: config.trackedSymbols.length };
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// REGISTRY OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function registerJobDefinition(def: JobDefinition): void {
  jobDefinitions.set(def.id, def);
  
  // Initialize state if not exists
  if (!jobStates.has(def.id)) {
    jobStates.set(def.id, {
      id: def.id,
      enabled: true,
      running: false,
      status: 'IDLE',
      config: {
        scheduleMs: def.defaultScheduleMs,
        trackedSymbols: def.defaultSymbols,
        enabled: true,
      },
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      intervalHandle: null,
    });
  }
}

export function listJobs(): JobState[] {
  return Array.from(jobStates.values()).map(state => ({
    ...state,
    intervalHandle: null, // Don't expose internal handle
  }));
}

export function getJob(id: JobId): JobState | undefined {
  const state = jobStates.get(id);
  if (!state) return undefined;
  return { ...state, intervalHandle: null };
}

export function getJobDefinition(id: JobId): JobDefinition | undefined {
  return jobDefinitions.get(id);
}

// ═══════════════════════════════════════════════════════════════
// JOB LIFECYCLE
// ═══════════════════════════════════════════════════════════════

export function startJob(id: JobId): { ok: boolean; message: string } {
  const state = jobStates.get(id);
  const def = jobDefinitions.get(id);
  
  if (!state || !def) {
    return { ok: false, message: `Job ${id} not found` };
  }
  
  if (!state.enabled) {
    return { ok: false, message: `Job ${id} is disabled` };
  }
  
  if (state.running) {
    return { ok: false, message: `Job ${id} is already running` };
  }
  
  // Start interval
  const handle = setInterval(async () => {
    await executeJob(id);
  }, state.config.scheduleMs);
  
  state.intervalHandle = handle;
  state.running = true;
  state.status = 'RUNNING';
  
  console.log(`[JobsRegistry] Started job: ${id} (interval: ${state.config.scheduleMs}ms)`);
  return { ok: true, message: `Job ${id} started` };
}

export function stopJob(id: JobId): { ok: boolean; message: string } {
  const state = jobStates.get(id);
  
  if (!state) {
    return { ok: false, message: `Job ${id} not found` };
  }
  
  if (!state.running) {
    return { ok: false, message: `Job ${id} is not running` };
  }
  
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  
  state.running = false;
  state.status = 'STOPPED';
  
  console.log(`[JobsRegistry] Stopped job: ${id}`);
  return { ok: true, message: `Job ${id} stopped` };
}

export function patchJobConfig(
  id: JobId,
  patch: Partial<JobRuntimeConfig>
): { ok: boolean; message: string; config?: JobRuntimeConfig } {
  const state = jobStates.get(id);
  
  if (!state) {
    return { ok: false, message: `Job ${id} not found` };
  }
  
  // Apply patch
  state.config = { ...state.config, ...patch };
  
  // Handle enabled/disabled
  if (patch.enabled === false && state.running) {
    stopJob(id);
  }
  
  // Restart if schedule changed and running
  if (patch.scheduleMs && state.running) {
    stopJob(id);
    startJob(id);
  }
  
  console.log(`[JobsRegistry] Updated config for ${id}:`, patch);
  return { ok: true, message: `Job ${id} config updated`, config: state.config };
}

export async function runOnce(
  id: JobId,
  params?: { symbol?: string }
): Promise<JobExecutionResult> {
  return executeJob(id, params);
}

// ═══════════════════════════════════════════════════════════════
// JOB EXECUTION
// ═══════════════════════════════════════════════════════════════

async function executeJob(
  id: JobId,
  params?: { symbol?: string }
): Promise<JobExecutionResult> {
  const state = jobStates.get(id);
  const def = jobDefinitions.get(id);
  
  if (!state || !def) {
    return { ok: false, executionMs: 0, error: `Job ${id} not found` };
  }
  
  const startTime = Date.now();
  
  try {
    // Use custom symbols if provided
    const config = params?.symbol
      ? { ...state.config, trackedSymbols: [params.symbol] }
      : state.config;
    
    const result = await def.handler(config);
    
    const executionMs = Date.now() - startTime;
    state.lastRunAt = Date.now();
    state.lastRunStatus = result.ok ? 'OK' : 'ERROR';
    state.lastError = result.ok ? null : (result.error ?? 'Unknown error');
    
    if (!result.ok) {
      state.status = 'ERROR';
    }
    
    return { ...result, executionMs };
  } catch (error) {
    const executionMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    state.lastRunAt = Date.now();
    state.lastRunStatus = 'ERROR';
    state.lastError = errorMsg;
    state.status = 'ERROR';
    
    return { ok: false, executionMs, error: errorMsg };
  }
}

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

export function getJobsStats() {
  const all = listJobs();
  return {
    total: all.length,
    running: all.filter(j => j.running).length,
    stopped: all.filter(j => !j.running && j.status !== 'ERROR').length,
    error: all.filter(j => j.status === 'ERROR').length,
  };
}

// Initialize on load
initializeDefaultJobs();

console.log('[Y1] Jobs Registry loaded');
