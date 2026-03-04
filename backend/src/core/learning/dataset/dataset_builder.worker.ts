/**
 * Dataset Builder Worker
 * 
 * ETAP 3.4: Periodically builds ML training samples.
 * 
 * Runs every 60 minutes when enabled.
 * Processes snapshots with complete truth chain.
 */
import { 
  runDatasetBuild, 
  getSamples,
} from './dataset_builder.service.js';
import { 
  getDatasetStats, 
  checkDatasetQuality,
} from './dataset_quality.service.js';
import type { DatasetBuildConfig, BuildRunResult } from '../types/dataset.types.js';

// ==================== WORKER STATE ====================

interface WorkerState {
  running: boolean;
  intervalId: NodeJS.Timeout | null;
  lastRunAt: Date | null;
  lastResult: BuildRunResult | null;
  totalRuns: number;
  totalCreated: number;
  totalErrors: number;
}

const state: WorkerState = {
  running: false,
  intervalId: null,
  lastRunAt: null,
  lastResult: null,
  totalRuns: 0,
  totalCreated: 0,
  totalErrors: 0,
};

// Configuration
const INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const DEFAULT_CONFIG: DatasetBuildConfig = {
  horizons: ['1d', '7d', '30d'],
  mode: 'incremental',
  limit: 500,
  includeNoLive: true,
  includeCriticalDrift: false, // Exclude CRITICAL drift from training
};

// ==================== WORKER FUNCTIONS ====================

/**
 * Execute one build cycle
 */
async function runCycle(): Promise<void> {
  if (!state.running) return;
  
  console.log('[DatasetWorker] Running build cycle...');
  
  try {
    const result = await runDatasetBuild(DEFAULT_CONFIG);
    
    state.lastRunAt = new Date();
    state.lastResult = result;
    state.totalRuns++;
    state.totalCreated += result.stats.created;
    state.totalErrors += result.stats.errors;
    
    console.log(`[DatasetWorker] Cycle complete: +${result.stats.created} samples, ${result.stats.skipped} skipped`);
    
  } catch (error: any) {
    console.error('[DatasetWorker] Cycle failed:', error);
    state.totalErrors++;
  }
}

/**
 * Start the dataset builder worker
 */
export function startDatasetWorker(): { success: boolean; message: string } {
  if (state.running) {
    return { success: false, message: 'Worker already running' };
  }
  
  console.log('[DatasetWorker] Starting...');
  
  state.running = true;
  
  // Run immediately
  runCycle();
  
  // Schedule periodic runs
  state.intervalId = setInterval(() => {
    runCycle();
  }, INTERVAL_MS);
  
  return { success: true, message: 'Worker started' };
}

/**
 * Stop the dataset builder worker
 */
export function stopDatasetWorker(): { success: boolean; message: string } {
  if (!state.running) {
    return { success: false, message: 'Worker not running' };
  }
  
  console.log('[DatasetWorker] Stopping...');
  
  state.running = false;
  
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  
  return { success: true, message: 'Worker stopped' };
}

/**
 * Get worker status
 */
export async function getDatasetWorkerStatus(): Promise<{
  running: boolean;
  lastRunAt: Date | null;
  lastResult: BuildRunResult | null;
  totalRuns: number;
  totalCreated: number;
  totalErrors: number;
  intervalMs: number;
  datasetStats: Awaited<ReturnType<typeof getDatasetStats>>;
  qualityAlerts: Awaited<ReturnType<typeof checkDatasetQuality>>;
}> {
  const [datasetStats, qualityAlerts] = await Promise.all([
    getDatasetStats(),
    checkDatasetQuality(),
  ]);
  
  return {
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    totalRuns: state.totalRuns,
    totalCreated: state.totalCreated,
    totalErrors: state.totalErrors,
    intervalMs: INTERVAL_MS,
    datasetStats,
    qualityAlerts,
  };
}

/**
 * Run a single build cycle manually
 */
export async function runDatasetWorkerOnce(
  config?: Partial<DatasetBuildConfig>
): Promise<{
  success: boolean;
  result: BuildRunResult | null;
  error?: string;
}> {
  console.log('[DatasetWorker] Manual run triggered');
  
  const buildConfig: DatasetBuildConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };
  
  try {
    const result = await runDatasetBuild(buildConfig);
    
    state.lastRunAt = new Date();
    state.lastResult = result;
    state.totalRuns++;
    state.totalCreated += result.stats.created;
    state.totalErrors += result.stats.errors;
    
    return { success: true, result };
    
  } catch (error: any) {
    console.error('[DatasetWorker] Manual run failed:', error);
    return { success: false, result: null, error: error.message };
  }
}
