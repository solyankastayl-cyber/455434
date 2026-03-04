/**
 * ML Accuracy Snapshot Job - ML v2.1 STEP 2
 * 
 * Cron job that computes accuracy snapshots for all networks.
 * Runs every 6 hours.
 */

import { computeAllSnapshots } from '../core/ml/validation/accuracy.service.js';

// ============================================
// JOB
// ============================================

/**
 * Main accuracy snapshot job
 */
export async function runAccuracySnapshotJob(): Promise<{
  computed: number;
  duration: number;
  errors: string[];
}> {
  console.log('[AccuracySnapshotJob] Starting accuracy snapshot computation...');
  
  const startTime = Date.now();
  const errors: string[] = [];
  let computed = 0;
  
  try {
    const result = await computeAllSnapshots(['1d', '7d']);
    computed = result.computed;
    
    console.log(`[AccuracySnapshotJob] Complete. Computed ${computed} snapshots.`);
  } catch (err: any) {
    console.error('[AccuracySnapshotJob] Job failed:', err.message);
    errors.push(err.message);
  }
  
  return {
    computed,
    duration: Date.now() - startTime,
    errors,
  };
}

export default {
  runAccuracySnapshotJob,
};
