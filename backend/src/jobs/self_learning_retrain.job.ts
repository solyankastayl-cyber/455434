/**
 * Self-Learning Retrain Job (ETAP 5.1)
 * 
 * Scheduled job that checks if retrain is possible and safe.
 * Runs every 6 hours by default.
 * 
 * CRITICAL: Only retrains if ALL guards pass.
 */
import { attemptRetrain } from '../core/self_learning/self_learning_orchestrator.service.js';
import { getSelfLearningConfig } from '../core/self_learning/self_learning_config.model.js';

export interface SelfLearningJobResult {
  executed: boolean;
  reason: string;
  results: {
    '7d'?: any;
    '30d'?: any;
  };
  duration: number;
}

/**
 * Run self-learning job
 * Attempts retrain for both 7d and 30d horizons
 */
export async function runSelfLearningJob(): Promise<SelfLearningJobResult> {
  const start = Date.now();
  
  console.log('[Job: Self-Learning] ========== STARTING ==========');
  
  try {
    // Check if self-learning is enabled
    const config = await getSelfLearningConfig();
    
    if (!config.selfLearningEnabled) {
      console.log('[Job: Self-Learning] Self-learning is disabled (kill switch)');
      
      return {
        executed: false,
        reason: 'Self-learning disabled',
        results: {},
        duration: Date.now() - start,
      };
    }
    
    console.log('[Job: Self-Learning] Self-learning is enabled');
    
    // Attempt retrain for both horizons
    const results: any = {};
    
    // 7d horizon
    console.log('[Job: Self-Learning] Attempting 7d retrain...');
    const result7d = await attemptRetrain('7d');
    results['7d'] = {
      success: result7d.success,
      guardPassed: result7d.guardPassed,
      datasetVersion: result7d.datasetVersion,
      blockedReasons: result7d.blockedReasons,
      error: result7d.error,
    };
    
    // 30d horizon
    console.log('[Job: Self-Learning] Attempting 30d retrain...');
    const result30d = await attemptRetrain('30d');
    results['30d'] = {
      success: result30d.success,
      guardPassed: result30d.guardPassed,
      datasetVersion: result30d.datasetVersion,
      blockedReasons: result30d.blockedReasons,
      error: result30d.error,
    };
    
    const duration = Date.now() - start;
    
    console.log('[Job: Self-Learning] ========== COMPLETE ==========');
    console.log(`[Job: Self-Learning] 7d: ${result7d.success ? '✅ Success' : '❌ Failed/Blocked'}`);
    console.log(`[Job: Self-Learning] 30d: ${result30d.success ? '✅ Success' : '❌ Failed/Blocked'}`);
    console.log(`[Job: Self-Learning] Duration: ${duration}ms`);
    
    return {
      executed: true,
      reason: 'Retrain attempts completed',
      results,
      duration,
    };
    
  } catch (error: any) {
    console.error('[Job: Self-Learning] ❌ Job failed:', error);
    
    return {
      executed: false,
      reason: `Job failed: ${error.message}`,
      results: {},
      duration: Date.now() - start,
    };
  }
}

/**
 * Get job status (for monitoring)
 */
export function getSelfLearningJobStatus() {
  return {
    jobName: 'self_learning_retrain',
    interval: '6 hours',
    description: 'Attempts model retraining if guards pass',
    guardChecks: [
      'Kill switch enabled',
      'Cooldown period elapsed',
      'Sufficient samples',
      'Drift level acceptable',
      'LIVE data share sufficient',
      'Dataset quality adequate',
      'Schema integrity maintained',
      'Backlog health good',
    ],
  };
}
