/**
 * Bootstrap Stats (P2.3.B)
 * 
 * Aggregated indexing statistics for global status.
 * Emits WS events when stats change.
 */
import { BootstrapTaskModel } from './bootstrap_tasks.model.js';
import { eventBus } from '../websocket/event-bus.js';

/**
 * Indexing status contract
 */
export interface IndexingStatus {
  activeTasks: number;
  queuedTasks: number;
  failedTasks: number;
  lastUpdated: string;
  state: 'idle' | 'indexing' | 'error';
}

// Throttle state
let lastEmitTime = 0;
const THROTTLE_MS = 2000;

/**
 * Get current indexing status from database
 */
export async function getIndexingStatus(): Promise<IndexingStatus> {
  const [activeTasks, queuedTasks, failedTasks] = await Promise.all([
    BootstrapTaskModel.countDocuments({ status: 'running' }),
    BootstrapTaskModel.countDocuments({ status: 'queued' }),
    // Only count recent failures (last hour)
    BootstrapTaskModel.countDocuments({
      status: 'failed',
      updatedAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
    }),
  ]);

  // Determine state (corrected logic)
  // Active work takes priority over errors
  let state: 'idle' | 'indexing' | 'error';
  if (activeTasks > 0 || queuedTasks > 0) {
    state = 'indexing';
  } else if (failedTasks > 0) {
    state = 'error';
  } else {
    state = 'idle';
  }

  return {
    activeTasks,
    queuedTasks,
    failedTasks,
    lastUpdated: new Date().toISOString(),
    state,
  };
}

/**
 * Emit stats update via WebSocket (throttled)
 * 
 * Call this when:
 * - task enqueued
 * - task claimed
 * - task done
 * - task failed
 */
export async function emitStatsUpdate(): Promise<void> {
  const now = Date.now();
  
  // Throttle: max 1 emit per 2 seconds
  if (now - lastEmitTime < THROTTLE_MS) {
    return;
  }
  
  lastEmitTime = now;
  
  try {
    const status = await getIndexingStatus();
    
    eventBus.emit({
      type: 'bootstrap.stats.updated',
      ...status,
    });
    
    console.log(`[Bootstrap Stats] Emitted: state=${status.state}, active=${status.activeTasks}, queued=${status.queuedTasks}`);
  } catch (err) {
    console.error('[Bootstrap Stats] Failed to emit update:', err);
  }
}

/**
 * Force emit (bypasses throttle)
 * Use sparingly - for initial connection or explicit refresh
 */
export async function forceEmitStats(): Promise<void> {
  lastEmitTime = 0;
  await emitStatsUpdate();
}
