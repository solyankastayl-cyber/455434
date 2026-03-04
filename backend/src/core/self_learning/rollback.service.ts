/**
 * Rollback Service (ETAP 5.6)
 * 
 * Instant rollback to previous model or rules-only mode.
 * 
 * INVARIANTS:
 * - Rollback is always possible and safe
 * - Rollback is atomic
 * - All rollbacks are logged (never-silent)
 * - Inference continues working after rollback
 */
import { MLModelVersionModel, updateModelStatus } from './ml_model_version.model.js';
import {
  rollbackToPrevious,
  clearActiveModel,
  getPointer,
  getActiveModelId,
} from './active_model_pointer.model.js';
import { logSelfLearningEvent } from './audit_helpers.js';

// ==================== TYPES ====================

export type RollbackType = 'TO_PREVIOUS' | 'TO_RULES_ONLY';

export interface RollbackRequest {
  horizon: '7d' | '30d';
  reason: string;
  triggeredBy: string;
  type?: RollbackType;
}

export interface RollbackResult {
  success: boolean;
  horizon: '7d' | '30d';
  type: RollbackType;
  rolledBackFrom: string | null;
  rolledBackTo: string | null;
  reason: string;
  triggeredBy: string;
  timestamp: Date;
}

// ==================== ROLLBACK LOGIC ====================

/**
 * Rollback to previous model
 * 
 * If no previous model, falls back to rules-only.
 */
export async function rollback(request: RollbackRequest): Promise<RollbackResult> {
  const { horizon, reason, triggeredBy, type = 'TO_PREVIOUS' } = request;
  const timestamp = new Date();
  
  console.log(`[Rollback] ========== ROLLBACK: ${horizon} ==========`);
  console.log(`[Rollback] Type: ${type}, Reason: ${reason}`);
  
  // Log start
  await logSelfLearningEvent({
    eventType: 'ROLLBACK_STARTED',
    horizon,
    details: { type, reason, triggeredBy },
    triggeredBy,
    severity: 'warning',
  });
  
  try {
    const currentModelId = await getActiveModelId(horizon);
    
    // If type is TO_RULES_ONLY, clear active model
    if (type === 'TO_RULES_ONLY') {
      return await rollbackToRulesOnly(horizon, reason, triggeredBy, currentModelId, timestamp);
    }
    
    // Try rollback to previous
    const result = await rollbackToPrevious(horizon, triggeredBy, reason);
    
    if (!result.success) {
      // No previous model, fall back to rules-only
      console.log(`[Rollback] No previous model, falling back to rules-only`);
      return await rollbackToRulesOnly(horizon, reason, triggeredBy, currentModelId, timestamp);
    }
    
    // Update model statuses
    if (currentModelId) {
      await updateModelStatus(currentModelId, 'ROLLED_BACK', reason);
    }
    
    if (result.rolledBackTo) {
      await updateModelStatus(result.rolledBackTo, 'ACTIVE', 'Restored via rollback');
    }
    
    // Log success
    await logSelfLearningEvent({
      eventType: 'ROLLBACK_SUCCEEDED',
      horizon,
      modelVersionId: result.rolledBackTo || undefined,
      details: {
        type: 'TO_PREVIOUS',
        rolledBackFrom: currentModelId,
        rolledBackTo: result.rolledBackTo,
        reason,
        triggeredBy,
      },
      triggeredBy,
      severity: 'warning',
    });
    
    console.log(`[Rollback] ✅ SUCCESS: ${currentModelId} → ${result.rolledBackTo}`);
    
    return {
      success: true,
      horizon,
      type: 'TO_PREVIOUS',
      rolledBackFrom: currentModelId,
      rolledBackTo: result.rolledBackTo,
      reason,
      triggeredBy,
      timestamp,
    };
    
  } catch (error: any) {
    console.error(`[Rollback] Error:`, error);
    
    await logSelfLearningEvent({
      eventType: 'ROLLBACK_FAILED',
      horizon,
      details: {
        error: error.message,
        reason,
        triggeredBy,
      },
      triggeredBy,
      severity: 'error',
    });
    
    return {
      success: false,
      horizon,
      type,
      rolledBackFrom: null,
      rolledBackTo: null,
      reason: `Rollback failed: ${error.message}`,
      triggeredBy,
      timestamp,
    };
  }
}

/**
 * Rollback to rules-only mode (no ML)
 */
async function rollbackToRulesOnly(
  horizon: '7d' | '30d',
  reason: string,
  triggeredBy: string,
  currentModelId: string | null,
  timestamp: Date
): Promise<RollbackResult> {
  // Clear active model
  await clearActiveModel(horizon, triggeredBy, reason);
  
  // Update model status if exists
  if (currentModelId) {
    await updateModelStatus(currentModelId, 'ROLLED_BACK', reason);
  }
  
  // Log
  await logSelfLearningEvent({
    eventType: 'ROLLBACK_SUCCEEDED',
    horizon,
    details: {
      type: 'TO_RULES_ONLY',
      rolledBackFrom: currentModelId,
      rolledBackTo: null,
      reason,
      triggeredBy,
    },
    triggeredBy,
    severity: 'warning',
  });
  
  console.log(`[Rollback] ✅ Rolled back to rules-only mode`);
  
  return {
    success: true,
    horizon,
    type: 'TO_RULES_ONLY',
    rolledBackFrom: currentModelId,
    rolledBackTo: null,
    reason,
    triggeredBy,
    timestamp,
  };
}

/**
 * Auto-rollback triggered by shadow monitor
 */
export async function autoRollback(
  horizon: '7d' | '30d',
  reason: string,
  monitorReportId?: string
): Promise<RollbackResult> {
  console.log(`[Rollback] AUTO-ROLLBACK triggered for ${horizon}`);
  
  await logSelfLearningEvent({
    eventType: 'AUTO_ROLLBACK_TRIGGERED',
    horizon,
    details: {
      reason,
      monitorReportId,
    },
    triggeredBy: 'shadow_monitor',
    severity: 'critical',
  });
  
  return rollback({
    horizon,
    reason: `Auto-rollback: ${reason}`,
    triggeredBy: 'shadow_monitor',
    type: 'TO_PREVIOUS',
  });
}

/**
 * Get rollback status
 */
export async function getRollbackStatus(horizon: '7d' | '30d') {
  const pointer = await getPointer(horizon);
  
  const canRollback = pointer.previousModelId !== null;
  const previousModel = pointer.previousModelId
    ? await MLModelVersionModel.findOne({ modelId: pointer.previousModelId }).lean()
    : null;
  
  return {
    horizon,
    canRollback,
    currentModelId: pointer.activeModelId,
    previousModelId: pointer.previousModelId,
    previousModel: previousModel ? {
      modelId: previousModel.modelId,
      trainedAt: previousModel.trainedAt,
      precision: previousModel.trainMetrics?.precision,
    } : null,
    rollbackCount: pointer.rollbackCount,
    lastRollbackAt: pointer.lastRollbackAt,
  };
}

/**
 * Get rollback history from audit log
 */
export async function getRollbackHistory(horizon?: '7d' | '30d', limit: number = 20) {
  const { SelfLearningAuditLogModel } = await import('./audit_helpers.js');
  
  const query: any = {
    eventType: { $in: ['ROLLBACK_STARTED', 'ROLLBACK_SUCCEEDED', 'ROLLBACK_FAILED', 'AUTO_ROLLBACK_TRIGGERED'] },
  };
  
  if (horizon) {
    query.horizon = horizon;
  }
  
  return SelfLearningAuditLogModel
    .find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
