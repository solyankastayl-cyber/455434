/**
 * Signal Reweighting Job
 * 
 * Periodically analyzes outcomes and adjusts signal weights.
 * Runs every 6 hours.
 */
import { batchReweighting, getSignalReweightingStats } from '../core/signal_reweighting/signal_reweighting.service.js';

interface SignalReweightingJobResult {
  processed: number;
  adjustments: number;
  errors: number;
  stats: any;
  duration: number;
}

/**
 * Run signal reweighting job
 */
export async function runSignalReweighting(): Promise<SignalReweightingJobResult> {
  const start = Date.now();
  
  console.log('[Job: Signal Reweighting] Starting...');
  
  try {
    // Run batch reweighting for both horizons
    const result7d = await batchReweighting('7d', 24); // Last 24 hours
    const result30d = await batchReweighting('30d', 72); // Last 72 hours
    
    const processed = result7d.processed + result30d.processed;
    const adjustments = result7d.adjustments.length + result30d.adjustments.length;
    const errors = result7d.errors.length + result30d.errors.length;
    
    // Get updated stats
    const stats = await getSignalReweightingStats();
    
    const duration = Date.now() - start;
    
    console.log(
      `[Job: Signal Reweighting] Complete: ${processed} outcomes processed, ` +
      `${adjustments} adjustments made, ${errors} errors (${duration}ms)`
    );
    
    return {
      processed,
      adjustments,
      errors,
      stats,
      duration,
    };
    
  } catch (err: any) {
    console.error('[Job: Signal Reweighting] Failed:', err);
    throw err;
  }
}

/**
 * Get job status
 */
export function getSignalReweightingJobStatus() {
  return {
    jobName: 'signal_reweighting',
    interval: '6 hours',
    description: 'Adjusts signal weights based on outcome effectiveness',
  };
}
