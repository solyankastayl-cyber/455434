/**
 * Phase 7: Batch Simulation Domain Types
 */

// ═══════════════════════════════════════════════════════════════
// TASK TYPES
// ═══════════════════════════════════════════════════════════════

export type TaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';

export interface BatchTask {
  runId: string;
  taskId: string;
  
  symbol: string;
  tf: string;
  
  startTs: number;
  endTs: number;
  
  stepBars: number;
  warmupBars: number;
  horizonBars: number;
  
  status: TaskStatus;
  attempts: number;
  lastError?: string;
  
  // Progress tracking
  processedBars?: number;
  totalBars?: number;
  tradesOpened?: number;
  tradesClosed?: number;
  rowsWritten?: number;
  
  // Lease for concurrency
  leasedBy?: string;
  leaseUntil?: number;
  
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ═══════════════════════════════════════════════════════════════
// RUN TYPES
// ═══════════════════════════════════════════════════════════════

export type RunStatus = 'CREATED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';

export interface BatchRunConfig {
  stepBars: number;
  warmupBars: number;
  horizonBars: number;
  maxConcurrentTasks: number;
  chunkDays: number;
  deterministicSeed: number;
}

export interface BatchRunProgress {
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  doneTasks: number;
  failedTasks: number;
  
  rowsWritten: number;
  tradesClosed: number;
  
  winRate?: number;
  avgR?: number;
  expectancy?: number;
}

export interface BatchRun {
  runId: string;
  name: string;
  
  symbols: string[];
  tfs: string[];
  
  dateRanges: Array<{ startTs: number; endTs: number }>;
  
  config: BatchRunConfig;
  status: RunStatus;
  progress: BatchRunProgress;
  
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG PRESETS
// ═══════════════════════════════════════════════════════════════

export const TF_CONFIGS: Record<string, Partial<BatchRunConfig>> = {
  '1d': {
    warmupBars: 50,  // Reduced for batch generation
    horizonBars: 30,
    chunkDays: 365,  // Larger chunks
  },
  '4h': {
    warmupBars: 100,
    horizonBars: 90,
    chunkDays: 180,
  },
  '1h': {
    warmupBars: 150,
    horizonBars: 240,
    chunkDays: 60,
  },
};

export const DEFAULT_CONFIG: BatchRunConfig = {
  stepBars: 1,
  warmupBars: 250,
  horizonBars: 30,
  maxConcurrentTasks: 2,
  chunkDays: 180,
  deterministicSeed: 42,
};

// ═══════════════════════════════════════════════════════════════
// REQUEST/RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface CreateBatchRunRequest {
  name?: string;
  symbols: string[];
  tfs: string[];
  startTs: number;
  endTs: number;
  config?: Partial<BatchRunConfig>;
}

export interface BatchRunSummary {
  runId: string;
  name: string;
  status: RunStatus;
  symbols: string[];
  tfs: string[];
  progress: BatchRunProgress;
  createdAt: number;
}
