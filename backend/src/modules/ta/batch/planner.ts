/**
 * Phase 7: Batch Simulation Planner
 * 
 * Creates tasks by chunking date ranges for parallel processing.
 */

import { v4 as uuid } from 'uuid';
import {
  BatchRun,
  BatchTask,
  BatchRunConfig,
  TF_CONFIGS,
  DEFAULT_CONFIG,
} from './domain.js';

// ═══════════════════════════════════════════════════════════════
// CHUNKING
// ═══════════════════════════════════════════════════════════════

const DAY_MS = 24 * 60 * 60 * 1000;

interface DateChunk {
  startTs: number;
  endTs: number;
}

/**
 * Split date range into chunks for parallel processing
 */
function chunkDateRange(startTs: number, endTs: number, chunkDays: number): DateChunk[] {
  const chunks: DateChunk[] = [];
  const chunkMs = chunkDays * DAY_MS;
  
  let current = startTs;
  while (current < endTs) {
    const chunkEnd = Math.min(current + chunkMs, endTs);
    chunks.push({ startTs: current, endTs: chunkEnd });
    current = chunkEnd;
  }
  
  return chunks;
}

// ═══════════════════════════════════════════════════════════════
// TASK CREATION
// ═══════════════════════════════════════════════════════════════

export interface PlanResult {
  tasks: BatchTask[];
  totalBars: number;
  estimatedTrades: number;
}

/**
 * Create batch tasks from run configuration
 */
export function createTasks(run: BatchRun): PlanResult {
  const tasks: BatchTask[] = [];
  let totalBars = 0;
  
  const now = Date.now();
  
  for (const symbol of run.symbols) {
    for (const tf of run.tfs) {
      // Get TF-specific config
      const tfConfig = TF_CONFIGS[tf.toLowerCase()] || {};
      const config: BatchRunConfig = {
        ...DEFAULT_CONFIG,
        ...run.config,
        ...tfConfig,
      };
      
      // Process each date range
      for (const range of run.dateRanges) {
        const chunks = chunkDateRange(range.startTs, range.endTs, config.chunkDays);
        
        for (const chunk of chunks) {
          // Calculate bars in chunk
          const tfMs = getTfMs(tf);
          const barsInChunk = Math.floor((chunk.endTs - chunk.startTs) / tfMs);
          totalBars += barsInChunk;
          
          tasks.push({
            runId: run.runId,
            taskId: uuid(),
            symbol,
            tf: tf.toUpperCase(),
            startTs: chunk.startTs,
            endTs: chunk.endTs,
            stepBars: config.stepBars,
            warmupBars: config.warmupBars,
            horizonBars: config.horizonBars,
            status: 'PENDING',
            attempts: 0,
            totalBars: barsInChunk,
            processedBars: 0,
            tradesOpened: 0,
            tradesClosed: 0,
            rowsWritten: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
  }
  
  // Estimate trades (rough: 1 trade per 20-50 bars on 1D)
  const estimatedTrades = Math.floor(totalBars / 30);
  
  return { tasks, totalBars, estimatedTrades };
}

/**
 * Get milliseconds per bar for timeframe
 */
function getTfMs(tf: string): number {
  const tfLower = tf.toLowerCase();
  
  switch (tfLower) {
    case '1m': return 60 * 1000;
    case '5m': return 5 * 60 * 1000;
    case '15m': return 15 * 60 * 1000;
    case '1h': return 60 * 60 * 1000;
    case '4h': return 4 * 60 * 60 * 1000;
    case '1d': return 24 * 60 * 60 * 1000;
    case '1w': return 7 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

// ═══════════════════════════════════════════════════════════════
// ESTIMATION
// ═══════════════════════════════════════════════════════════════

export interface EstimateResult {
  totalTasks: number;
  totalBars: number;
  estimatedTrades: number;
  estimatedRows: number;
  estimatedDuration: string;
}

/**
 * Estimate batch run without creating tasks
 */
export function estimateRun(
  symbols: string[],
  tfs: string[],
  startTs: number,
  endTs: number,
  config?: Partial<BatchRunConfig>
): EstimateResult {
  let totalTasks = 0;
  let totalBars = 0;
  
  for (const symbol of symbols) {
    for (const tf of tfs) {
      const tfConfig = TF_CONFIGS[tf.toLowerCase()] || {};
      const chunkDays = config?.chunkDays ?? tfConfig.chunkDays ?? DEFAULT_CONFIG.chunkDays;
      
      const chunks = chunkDateRange(startTs, endTs, chunkDays);
      totalTasks += chunks.length;
      
      const tfMs = getTfMs(tf);
      totalBars += Math.floor((endTs - startTs) / tfMs);
    }
  }
  
  const estimatedTrades = Math.floor(totalBars / 30);
  const estimatedRows = estimatedTrades;
  
  // Rough time estimate: 1 task per 30 seconds
  const estimatedSeconds = totalTasks * 30;
  const estimatedDuration = formatDuration(estimatedSeconds);
  
  return {
    totalTasks,
    totalBars,
    estimatedTrades,
    estimatedRows,
    estimatedDuration,
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
