/**
 * PHASE 5.2 — Promotion Job
 * ==========================
 * Promotes CANDIDATE to ACTIVE atomically
 */

import { v4 as uuidv4 } from 'uuid';
import { MlModelRegistry } from '../storage/ml_model.model.js';
import { ActiveModelState } from '../runtime/active_model.state.js';
import { MlRun } from '../storage/ml_run.model.js';

export interface PromotionResult {
  runId: string;
  activeModelId: string;
  prevActiveModelId: string | null;
}

/**
 * Promote CANDIDATE model to ACTIVE
 * - Demotes current ACTIVE to RETIRED
 * - Promotes CANDIDATE to ACTIVE
 * - Updates runtime state atomically
 */
export async function promoteCandidate(modelId: string): Promise<PromotionResult> {
  const runId = uuidv4();
  const startedAt = new Date();
  
  await MlRun.create({ 
    runId, 
    type: 'PROMOTION', 
    status: 'RUNNING', 
    startedAt,
    meta: { modelId } 
  });

  console.log(`[PromotionJob] Starting promotion of model ${modelId}`);

  try {
    // Verify candidate exists
    const candidate = await MlModelRegistry.findOne({ modelId, stage: 'CANDIDATE' });
    if (!candidate) {
      throw new Error(`Candidate model ${modelId} not found`);
    }

    // Check metrics are acceptable
    if (candidate.metrics.ece > 0.30) {
      throw new Error(`Candidate ECE ${candidate.metrics.ece.toFixed(3)} > 0.30 threshold`);
    }

    const currentActiveId = ActiveModelState.getActive();

    // Demote current active to retired (if exists)
    if (currentActiveId) {
      await MlModelRegistry.updateOne(
        { modelId: currentActiveId, stage: 'ACTIVE' },
        { $set: { stage: 'RETIRED' } }
      );
      console.log(`[PromotionJob] Demoted ${currentActiveId} to RETIRED`);
    }

    // Promote candidate to active
    await MlModelRegistry.updateOne(
      { modelId, stage: 'CANDIDATE' },
      { 
        $set: { 
          stage: 'ACTIVE', 
          promotedAt: new Date(),
          'shadow.critStreak': 0,
          'shadow.degStreak': 0,
        } 
      }
    );

    // Update runtime state
    ActiveModelState.setActive(modelId);
    ActiveModelState.setCandidate(null);

    // Update run status
    await MlRun.updateOne(
      { runId },
      { 
        $set: { 
          status: 'DONE', 
          finishedAt: new Date(), 
          meta: { modelId, prevActive: currentActiveId } 
        } 
      }
    );

    console.log(`[PromotionJob] Promoted ${modelId} to ACTIVE, prev: ${currentActiveId}`);

    return { 
      runId, 
      activeModelId: modelId, 
      prevActiveModelId: currentActiveId 
    };
  } catch (e: any) {
    console.error(`[PromotionJob] Failed:`, e);
    
    await MlRun.updateOne(
      { runId },
      { $set: { status: 'FAILED', finishedAt: new Date(), error: String(e?.message ?? e) } }
    );
    throw e;
  }
}

/**
 * Rollback to previous active model
 * Used when current ACTIVE model degrades
 */
export async function rollbackToPrevious(): Promise<PromotionResult> {
  const runId = uuidv4();
  const startedAt = new Date();
  
  await MlRun.create({ 
    runId, 
    type: 'ROLLBACK', 
    status: 'RUNNING', 
    startedAt,
    meta: {} 
  });

  console.log(`[RollbackJob] Starting rollback`);

  try {
    const currentActiveId = ActiveModelState.getActive();
    const prevActiveId = ActiveModelState.getPrevActive();

    if (!prevActiveId) {
      throw new Error('No previous active model to rollback to');
    }

    // Verify prev active exists (as RETIRED)
    const prevModel = await MlModelRegistry.findOne({ modelId: prevActiveId });
    if (!prevModel) {
      throw new Error(`Previous model ${prevActiveId} not found`);
    }

    // Demote current active
    if (currentActiveId) {
      await MlModelRegistry.updateOne(
        { modelId: currentActiveId },
        { $set: { stage: 'RETIRED' } }
      );
      console.log(`[RollbackJob] Demoted ${currentActiveId} to RETIRED`);
    }

    // Restore prev active
    await MlModelRegistry.updateOne(
      { modelId: prevActiveId },
      { 
        $set: { 
          stage: 'ACTIVE',
          'shadow.critStreak': 0,
          'shadow.degStreak': 0,
        } 
      }
    );

    // Update runtime state
    ActiveModelState.setActive(prevActiveId);
    ActiveModelState.setPrevActive(currentActiveId);

    // Update run status
    await MlRun.updateOne(
      { runId },
      { 
        $set: { 
          status: 'DONE', 
          finishedAt: new Date(), 
          meta: { 
            restoredModelId: prevActiveId,
            demotedModelId: currentActiveId,
          } 
        } 
      }
    );

    console.log(`[RollbackJob] Rolled back to ${prevActiveId}`);

    return { 
      runId, 
      activeModelId: prevActiveId, 
      prevActiveModelId: currentActiveId 
    };
  } catch (e: any) {
    console.error(`[RollbackJob] Failed:`, e);
    
    await MlRun.updateOne(
      { runId },
      { $set: { status: 'FAILED', finishedAt: new Date(), error: String(e?.message ?? e) } }
    );
    throw e;
  }
}

/**
 * Retire a candidate model (discard without promotion)
 */
export async function retireCandidate(modelId: string): Promise<{ runId: string }> {
  const runId = uuidv4();
  
  await MlRun.create({ 
    runId, 
    type: 'PROMOTION', 
    status: 'RUNNING', 
    startedAt: new Date(),
    meta: { modelId, action: 'RETIRE' } 
  });

  try {
    const candidate = await MlModelRegistry.findOne({ modelId, stage: 'CANDIDATE' });
    if (!candidate) {
      throw new Error(`Candidate model ${modelId} not found`);
    }

    await MlModelRegistry.updateOne(
      { modelId },
      { $set: { stage: 'RETIRED' } }
    );

    if (ActiveModelState.getCandidate() === modelId) {
      ActiveModelState.setCandidate(null);
    }

    await MlRun.updateOne(
      { runId },
      { $set: { status: 'DONE', finishedAt: new Date() } }
    );

    console.log(`[RetireJob] Retired candidate ${modelId}`);

    return { runId };
  } catch (e: any) {
    await MlRun.updateOne(
      { runId },
      { $set: { status: 'FAILED', finishedAt: new Date(), error: String(e?.message ?? e) } }
    );
    throw e;
  }
}

console.log('[Phase 5.2] Promotion Job loaded');
