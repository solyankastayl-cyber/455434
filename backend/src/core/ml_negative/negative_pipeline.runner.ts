/**
 * Negative Sample Pipeline Runner
 * 
 * EPIC 8: Main orchestrator for negative sample generation
 * 
 * DOES NOT trigger training
 * DOES NOT affect decisions
 * ONLY generates samples for SHADOW mode
 */

import { v4 as uuidv4 } from 'uuid';
import type { 
  NegativeRunConfig, 
  NegativeRunStats,
  NegativeSample 
} from './negative.types.js';
import { sampleCandidates } from './negative_sampler.service.js';
import { labelCandidates } from './negative_labeler.service.js';
import { balanceSamples, buildRunStats, validateDataset } from './negative_dataset.builder.js';
import { 
  createRun, 
  completeRun, 
  failRun, 
  saveSamplesBatch,
  getRun,
  getRecentRuns,
  getSampleStats 
} from './negative.store.js';
import { 
  logRunStarted, 
  logRunCompleted, 
  logRunFailed,
  logBalanceAdjusted 
} from './negative.audit.js';

/**
 * Run the negative sample pipeline
 */
export async function runNegativePipeline(
  config: NegativeRunConfig
): Promise<NegativeRunStats> {
  const runId = uuidv4();
  const { horizon, maxCandidates, targetSamples, dryRun } = config;
  
  console.log(`[NegativePipeline] Starting run ${runId}`);
  console.log(`[NegativePipeline] Config:`, { horizon, maxCandidates, targetSamples, dryRun });
  
  try {
    // 1. Create run record
    if (!dryRun) {
      await createRun(runId, horizon, {
        maxCandidates,
        targetSamples,
        window: config.window,
      });
      await logRunStarted(runId, { horizon, maxCandidates, targetSamples });
    }
    
    // 2. Sample candidates
    console.log(`[NegativePipeline] Sampling candidates...`);
    const { candidates, insufficientCount: samplerInsufficient } = await sampleCandidates({
      horizon: horizon as '7d' | '14d',
      maxCandidates,
    });
    
    console.log(`[NegativePipeline] Found ${candidates.length} candidates, ${samplerInsufficient} insufficient`);
    
    // 3. Label candidates
    console.log(`[NegativePipeline] Labeling candidates...`);
    const { samples: rawSamples, insufficientCount: labelerInsufficient } = labelCandidates(
      candidates,
      runId,
      horizon as '7d' | '14d'
    );
    
    const totalInsufficient = samplerInsufficient + labelerInsufficient;
    console.log(`[NegativePipeline] Labeled ${rawSamples.length} samples, ${totalInsufficient} total insufficient`);
    
    // 4. Balance dataset
    console.log(`[NegativePipeline] Balancing dataset...`);
    const { balanced, stats: balanceStats } = balanceSamples(rawSamples, {
      maxSamples: targetSamples,
    });
    
    if (balanceStats.droppedForBalance > 0 && !dryRun) {
      await logBalanceAdjusted(
        runId,
        rawSamples.length,
        balanced.length,
        `Dropped ${balanceStats.droppedForBalance} samples for balance`
      );
    }
    
    console.log(`[NegativePipeline] Balanced to ${balanced.length} samples`);
    console.log(`[NegativePipeline] Neg:Pos ratio = ${balanceStats.negPosRatio.toFixed(2)}`);
    
    // 5. Validate
    const validation = validateDataset(balanced);
    if (!validation.valid) {
      console.warn(`[NegativePipeline] Dataset validation issues:`, validation.issues);
    }
    
    // 6. Save samples
    if (!dryRun && balanced.length > 0) {
      console.log(`[NegativePipeline] Saving ${balanced.length} samples...`);
      await saveSamplesBatch(balanced);
    }
    
    // 7. Build final stats
    const stats = buildRunStats(
      runId,
      horizon,
      balanced,
      candidates.length,
      totalInsufficient,
      balanceStats.limitedTypes
    ) as NegativeRunStats;
    
    stats.startedAt = new Date();
    stats.status = 'COMPLETED';
    stats.reasons = validation.issues;
    
    // 8. Complete run
    if (!dryRun) {
      await completeRun(runId, stats);
      await logRunCompleted(runId, {
        samplesGenerated: stats.samplesGenerated,
        positiveCount: stats.positiveCount,
        negativeCount: stats.negativeCount,
        negPosRatio: stats.negPosRatio,
      });
    }
    
    console.log(`[NegativePipeline] Run ${runId} completed successfully`);
    return stats;
    
  } catch (error) {
    console.error(`[NegativePipeline] Run ${runId} failed:`, error);
    
    if (!dryRun) {
      await failRun(runId, error instanceof Error ? error.message : 'Unknown error');
      await logRunFailed(runId, error instanceof Error ? error.message : 'Unknown error');
    }
    
    throw error;
  }
}

/**
 * Get status of a run
 */
export async function getRunStatus(runId: string): Promise<NegativeRunStats | null> {
  const run = await getRun(runId);
  if (!run) return null;
  
  return {
    runId: run.runId,
    horizon: run.horizon,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: run.status,
    candidatesFound: run.candidatesFound,
    samplesGenerated: run.samplesGenerated,
    positiveCount: run.positiveCount,
    negativeCount: run.negativeCount,
    insufficientCount: run.insufficientCount,
    byType: run.byType as NegativeRunStats['byType'],
    negPosRatio: run.negPosRatio,
    typeDistribution: run.typeDistribution as NegativeRunStats['typeDistribution'],
    limitedTypes: run.limitedTypes as NegativeRunStats['limitedTypes'],
    reasons: run.reasons,
  };
}

/**
 * Get recent runs
 */
export { getRecentRuns };

/**
 * Get overall sample statistics
 */
export { getSampleStats };
