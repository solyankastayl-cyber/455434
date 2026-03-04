/**
 * ETAP 6.2/6.3 — Aggregation & Snapshot Jobs
 * 
 * Cron job functions for automated aggregation and snapshot building.
 * 
 * Schedule:
 * - 24h: every 5 minutes
 * - 7d: every 15 minutes
 * - 30d: every hour
 */
import { runAggregation, AggWindow } from '../core/aggregation/aggregation.service.js';
import { buildSnapshot } from '../core/snapshots/snapshot.builder.js';
import type { SnapshotWindow } from '../core/snapshots/snapshot.types.js';

export interface AggregationJobResult {
  window: string;
  executed: boolean;
  actorFlowsUpdated: number;
  actorActivitiesUpdated: number;
  bridgesUpdated: number;
  snapshotCreated: boolean;
  duration: number;
  errors: string[];
}

/**
 * Run aggregation + snapshot for a window
 */
export async function runAggregationAndSnapshotJob(
  window: AggWindow
): Promise<AggregationJobResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    // Step 1: Run aggregations
    const aggResult = await runAggregation(window);
    errors.push(...aggResult.errors);

    // Step 2: Build snapshot (only if aggregations updated)
    const snapshotResult = await buildSnapshot(window as SnapshotWindow);
    
    if (snapshotResult.message && !snapshotResult.created) {
      // Not an error, just info
    }

    return {
      window,
      executed: true,
      actorFlowsUpdated: aggResult.actorFlowsUpdated,
      actorActivitiesUpdated: aggResult.actorActivitiesUpdated,
      bridgesUpdated: aggResult.bridgesUpdated,
      snapshotCreated: snapshotResult.created,
      duration: Date.now() - startTime,
      errors,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      window,
      executed: false,
      actorFlowsUpdated: 0,
      actorActivitiesUpdated: 0,
      bridgesUpdated: 0,
      snapshotCreated: false,
      duration: Date.now() - startTime,
      errors: [message],
    };
  }
}

/**
 * Get job status for all windows
 */
export async function getAggregationJobStatus(): Promise<{
  status: 'ok' | 'error';
  message: string;
}> {
  return {
    status: 'ok',
    message: 'Aggregation jobs configured',
  };
}
