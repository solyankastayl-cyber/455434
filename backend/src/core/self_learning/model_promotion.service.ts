/**
 * Model Promotion Service
 * 
 * ETAP 5.5: Atomic model promotion and rollback.
 * 
 * INVARIANTS:
 * - promote ONLY if decision === PROMOTE
 * - activeModelState changes atomically
 * - previousModelId saved BEFORE switch
 * - rollback is idempotent
 */
import { ModelVersionModel } from './model_version.model.js';
import { ActiveModelStateModel } from './active_model.state.js';
import { getEvaluation } from './evaluation_gate.service.js';
import { logPromoteEvent, logRollbackEvent } from './audit_logger.service.js';
import type { Horizon } from './self_learning.types.js';

// ==================== ERRORS ====================

export class PromotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromotionError';
  }
}

// ==================== PROMOTION ====================

/**
 * Promote model to active
 * 
 * REQUIRES: evaluation decision === PROMOTE
 * THROWS: PromotionError if validation fails
 */
export async function promoteModelAtomic(modelVersionId: string): Promise<{
  success: boolean;
  previousModelId: string | null;
  message: string;
}> {
  console.log(`[Promotion] Attempting to promote ${modelVersionId}`);
  
  // Step 1: Get model
  const model = await ModelVersionModel.findOne({ modelVersion: modelVersionId });
  
  if (!model) {
    throw new PromotionError(`Model not found: ${modelVersionId}`);
  }
  
  // Step 2: Validate evaluation
  const evaluation = await getEvaluation(modelVersionId);
  
  if (!evaluation?.evaluated) {
    throw new PromotionError(`evaluation_required: Model must be evaluated before promotion`);
  }
  
  if (evaluation.decision !== 'PROMOTE') {
    throw new PromotionError(`evaluation_failed: Cannot promote model with decision ${evaluation.decision}`);
  }
  
  // Step 3: Check current status
  if (model.status === 'PROMOTED') {
    return {
      success: true,
      previousModelId: null,
      message: 'Model already promoted',
    };
  }
  
  if (model.status === 'REJECTED') {
    throw new PromotionError(`rejected_model: Cannot promote rejected model`);
  }
  
  const horizon = model.horizon as Horizon;
  
  // Step 4: Atomic switch
  const switchResult = await ActiveModelStateModel.atomicSwitch(
    horizon,
    modelVersionId,
    'PROMOTION'
  );
  
  // Step 5: Update model status
  await ModelVersionModel.updateOne(
    { modelVersion: modelVersionId },
    {
      status: 'PROMOTED',
      promotedAt: new Date(),
    }
  );
  
  // Step 6: Mark previous model as rolled back (if any)
  if (switchResult.previousModelId) {
    await ModelVersionModel.updateOne(
      { modelVersion: switchResult.previousModelId },
      { status: 'ROLLED_BACK' }
    );
  }
  
  // Step 7: Audit log
  await logPromoteEvent(horizon, modelVersionId, switchResult.previousModelId);
  
  console.log(`[Promotion] Model ${modelVersionId} promoted. Previous: ${switchResult.previousModelId || 'none'}`);
  
  return {
    success: true,
    previousModelId: switchResult.previousModelId,
    message: `Model promoted successfully`,
  };
}

// ==================== ROLLBACK ====================

/**
 * Rollback to previous model
 * 
 * Idempotent - safe to call multiple times
 */
export async function rollbackModelAtomic(
  horizon: Horizon,
  reason: string,
  triggeredBy: 'AUTO' | 'MANUAL' = 'MANUAL'
): Promise<{
  success: boolean;
  fromModelId: string | null;
  toModelId: string | null;
  message: string;
}> {
  console.log(`[Rollback] Initiating rollback for ${horizon}: ${reason}`);
  
  // Step 1: Get current state
  const currentState = await ActiveModelStateModel.getState(horizon);
  
  if (!currentState) {
    return {
      success: false,
      fromModelId: null,
      toModelId: null,
      message: 'No active model state found',
    };
  }
  
  if (!currentState.previousModelId) {
    return {
      success: false,
      fromModelId: currentState.activeModelId,
      toModelId: null,
      message: 'No previous model to rollback to',
    };
  }
  
  const fromModelId = currentState.activeModelId;
  const toModelId = currentState.previousModelId;
  
  // Step 2: Verify previous model exists and is valid
  const previousModel = await ModelVersionModel.findOne({ modelVersion: toModelId });
  
  if (!previousModel) {
    return {
      success: false,
      fromModelId,
      toModelId,
      message: `Previous model ${toModelId} not found`,
    };
  }
  
  // Step 3: Atomic switch
  await ActiveModelStateModel.atomicSwitch(horizon, toModelId, 'ROLLBACK');
  
  // Step 4: Update model statuses
  await ModelVersionModel.updateOne(
    { modelVersion: fromModelId },
    { status: 'ROLLED_BACK' }
  );
  
  await ModelVersionModel.updateOne(
    { modelVersion: toModelId },
    { 
      status: 'PROMOTED',
      promotedAt: new Date(),
    }
  );
  
  // Step 5: Audit log
  await logRollbackEvent(horizon, fromModelId, toModelId, reason, triggeredBy);
  
  console.log(`[Rollback] Rolled back from ${fromModelId} to ${toModelId}`);
  
  return {
    success: true,
    fromModelId,
    toModelId,
    message: `Rolled back successfully`,
  };
}

// ==================== QUERY ====================

/**
 * Get current active model ID for horizon
 */
export async function getActiveModelId(horizon: Horizon): Promise<string | null> {
  const state = await ActiveModelStateModel.getState(horizon);
  return state?.activeModelId || null;
}

/**
 * Get active model state
 */
export async function getActiveModelState(horizon: Horizon): Promise<{
  activeModelId: string | null;
  previousModelId: string | null;
  healthStatus: string;
  switchedAt: Date | null;
  switchReason: string | null;
} | null> {
  const state = await ActiveModelStateModel.getState(horizon);
  
  if (!state) {
    return null;
  }
  
  return {
    activeModelId: state.activeModelId,
    previousModelId: state.previousModelId,
    healthStatus: state.healthStatus,
    switchedAt: state.switchedAt,
    switchReason: state.switchReason,
  };
}

/**
 * Check if rollback is possible
 */
export async function canRollback(horizon: Horizon): Promise<boolean> {
  const state = await ActiveModelStateModel.getState(horizon);
  return !!(state?.previousModelId);
}
