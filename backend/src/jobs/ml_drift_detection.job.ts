/**
 * ML Drift Detection Job - ML v2.1 STEP 2
 * 
 * Cron job that checks for model degradation.
 * Runs every 12 hours.
 */

import { runAllDriftDetection } from '../core/ml/validation/drift.service.js';

// ============================================
// JOB
// ============================================

/**
 * Main drift detection job
 */
export async function runDriftDetectionJob(): Promise<{
  checked: number;
  drifts: number;
  duration: number;
  errors: string[];
}> {
  console.log('[DriftDetectionJob] Starting drift detection...');
  
  const startTime = Date.now();
  const errors: string[] = [];
  let checked = 0;
  let drifts = 0;
  
  try {
    const result = await runAllDriftDetection();
    checked = result.checked;
    drifts = result.drifts;
    
    console.log(`[DriftDetectionJob] Complete. Checked ${checked} networks, found ${drifts} drifts.`);
  } catch (err: any) {
    console.error('[DriftDetectionJob] Job failed:', err.message);
    errors.push(err.message);
  }
  
  return {
    checked,
    drifts,
    duration: Date.now() - startTime,
    errors,
  };
}

export default {
  runDriftDetectionJob,
};
