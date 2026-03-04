/**
 * Promotion Service (ETAP 5.5)
 * 
 * Safe activation of APPROVED models.
 * 
 * INVARIANTS:
 * - Only APPROVED models can be promoted
 * - Cooldown between promotions enforced
 * - Drift gate checked before promotion
 * - Kill switch respected
 * - Previous model preserved for rollback
 * - All decisions logged (never-silent)
 */
import { MLModelVersionModel, updateModelStatus, getActiveModel } from './ml_model_version.model.js';
import { 
  setActiveModel, 
  getActiveModelId, 
  getPointer 
} from './active_model_pointer.model.js';
import { getSelfLearningConfig } from './self_learning_config.model.js';
import { canRetrain } from './retrain_guard.service.js';
import { logSelfLearningEvent } from './audit_helpers.js';
import { EVALUATION_RULES } from './evaluation_rules.js';

// ==================== TYPES ====================

export type PromotionDecision = 'PROMOTED' | 'BLOCKED';

export interface PromotionBlockReason {
  code: string;
  message: string;
}

export interface PromotionRequest {
  modelId: string;
  horizon: '7d' | '30d';
  triggeredBy: string;
  force?: boolean; // Admin override (bypasses some checks)
}

export interface PromotionResult {
  success: boolean;
  decision: PromotionDecision;
  modelId: string;
  horizon: '7d' | '30d';
  previousModelId: string | null;
  blockedReasons: PromotionBlockReason[];
  promotedAt?: Date;
}

// ==================== CONSTANTS ====================

const PROMOTION_COOLDOWN_HOURS = 24; // Min time between promotions
const MAX_PROMOTIONS_PER_MONTH = 4;

// ==================== PROMOTION LOGIC ====================

/**
 * Promote APPROVED candidate to ACTIVE
 * 
 * Gate checks:
 * 1. Model exists and is APPROVED
 * 2. Kill switch not active
 * 3. Drift not CRITICAL
 * 4. Cooldown passed (unless force)
 * 5. Rate limit not exceeded (unless force)
 */
export async function promoteCandidate(request: PromotionRequest): Promise<PromotionResult> {
  const { modelId, horizon, triggeredBy, force = false } = request;
  const blockedReasons: PromotionBlockReason[] = [];
  
  console.log(`[Promotion] ========== PROMOTE ATTEMPT: ${modelId} ==========`);
  console.log(`[Promotion] Horizon: ${horizon}, TriggeredBy: ${triggeredBy}, Force: ${force}`);
  
  // Log start event
  await logSelfLearningEvent({
    eventType: 'PROMOTE_STARTED',
    horizon,
    modelVersionId: modelId,
    details: { triggeredBy, force },
    triggeredBy,
    severity: 'info',
  });
  
  try {
    // ========== CHECK 1: MODEL EXISTS AND IS APPROVED ==========
    
    const model = await MLModelVersionModel.findOne({ modelId }).lean();
    
    if (!model) {
      blockedReasons.push({
        code: 'MODEL_NOT_FOUND',
        message: `Model not found: ${modelId}`,
      });
      return blockPromotion(modelId, horizon, blockedReasons, triggeredBy);
    }
    
    if (model.status !== 'APPROVED') {
      blockedReasons.push({
        code: 'MODEL_NOT_APPROVED',
        message: `Model status is ${model.status}, must be APPROVED`,
      });
      return blockPromotion(modelId, horizon, blockedReasons, triggeredBy);
    }
    
    if (model.horizon !== horizon) {
      blockedReasons.push({
        code: 'HORIZON_MISMATCH',
        message: `Model horizon ${model.horizon} != requested ${horizon}`,
      });
      return blockPromotion(modelId, horizon, blockedReasons, triggeredBy);
    }
    
    // ========== CHECK 2: KILL SWITCH ==========
    
    const config = await getSelfLearningConfig();
    
    if (!config.selfLearningEnabled && !force) {
      blockedReasons.push({
        code: 'KILL_SWITCH_ACTIVE',
        message: 'Self-learning is disabled (kill switch)',
      });
      return blockPromotion(modelId, horizon, blockedReasons, triggeredBy);
    }
    
    // ========== CHECK 3: DRIFT CHECK ==========
    
    if (!force) {
      const guardSnapshot = await canRetrain(horizon);
      
      if (guardSnapshot.driftGuard?.level === 'CRITICAL') {
        blockedReasons.push({
          code: 'DRIFT_CRITICAL',
          message: 'Drift level is CRITICAL, promotion blocked',
        });
        return blockPromotion(modelId, horizon, blockedReasons, triggeredBy);
      }
    }
    
    // ========== CHECK 4: COOLDOWN ==========
    
    if (!force) {
      const pointer = await getPointer(horizon);
      
      if (pointer.switchedAt) {
        const hoursSinceSwitch = (Date.now() - pointer.switchedAt.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceSwitch < PROMOTION_COOLDOWN_HOURS) {
          blockedReasons.push({
            code: 'COOLDOWN_NOT_PASSED',
            message: `Promotion cooldown: ${hoursSinceSwitch.toFixed(1)}h / ${PROMOTION_COOLDOWN_HOURS}h`,
          });
          return blockPromotion(modelId, horizon, blockedReasons, triggeredBy);
        }
      }
    }
    
    // ========== CHECK 5: RATE LIMIT ==========
    
    if (!force) {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      
      const recentPromotions = await MLModelVersionModel.countDocuments({
        horizon,
        status: 'ACTIVE',
        activatedAt: { $gte: monthAgo },
      });
      
      if (recentPromotions >= MAX_PROMOTIONS_PER_MONTH) {
        blockedReasons.push({
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Max ${MAX_PROMOTIONS_PER_MONTH} promotions/month (current: ${recentPromotions})`,
        });
        return blockPromotion(modelId, horizon, blockedReasons, triggeredBy);
      }
    }
    
    // ========== ALL CHECKS PASSED: PROMOTE ==========
    
    const previousModelId = await getActiveModelId(horizon);
    
    // Deactivate previous model if exists
    if (previousModelId) {
      await updateModelStatus(previousModelId, 'INACTIVE', 'Replaced by newer model');
    }
    
    // Activate new model
    await updateModelStatus(modelId, 'ACTIVE', `Promoted by ${triggeredBy}`);
    
    // Update pointer
    await setActiveModel(
      horizon,
      modelId,
      triggeredBy,
      `Promotion from APPROVED`
    );
    
    const promotedAt = new Date();
    
    // Update model with activation timestamp
    await MLModelVersionModel.updateOne(
      { modelId },
      { $set: { activatedAt: promotedAt } }
    );
    
    // Log success
    await logSelfLearningEvent({
      eventType: 'PROMOTE_SUCCEEDED',
      horizon,
      modelVersionId: modelId,
      details: {
        previousModelId,
        triggeredBy,
        force,
      },
      triggeredBy,
      severity: 'info',
    });
    
    console.log(`[Promotion] ✅ SUCCESS: ${modelId} is now ACTIVE`);
    console.log(`[Promotion] Previous: ${previousModelId || 'none'}`);
    
    return {
      success: true,
      decision: 'PROMOTED',
      modelId,
      horizon,
      previousModelId,
      blockedReasons: [],
      promotedAt,
    };
    
  } catch (error: any) {
    console.error(`[Promotion] Error:`, error);
    
    await logSelfLearningEvent({
      eventType: 'PROMOTE_BLOCKED',
      horizon,
      modelVersionId: modelId,
      details: {
        error: error.message,
        triggeredBy,
      },
      triggeredBy,
      severity: 'error',
    });
    
    return {
      success: false,
      decision: 'BLOCKED',
      modelId,
      horizon,
      previousModelId: null,
      blockedReasons: [{
        code: 'INTERNAL_ERROR',
        message: error.message,
      }],
    };
  }
}

/**
 * Helper to log and return blocked promotion
 */
async function blockPromotion(
  modelId: string,
  horizon: '7d' | '30d',
  reasons: PromotionBlockReason[],
  triggeredBy: string
): Promise<PromotionResult> {
  console.log(`[Promotion] ❌ BLOCKED: ${reasons.map(r => r.code).join(', ')}`);
  
  await logSelfLearningEvent({
    eventType: 'PROMOTE_BLOCKED',
    horizon,
    modelVersionId: modelId,
    details: {
      reasons: reasons.map(r => r.message),
      triggeredBy,
    },
    triggeredBy,
    severity: 'warning',
  });
  
  return {
    success: false,
    decision: 'BLOCKED',
    modelId,
    horizon,
    previousModelId: null,
    blockedReasons: reasons,
  };
}

/**
 * Check if model can be promoted (dry run)
 */
export async function canPromote(modelId: string, horizon: '7d' | '30d'): Promise<{
  canPromote: boolean;
  blockedReasons: PromotionBlockReason[];
}> {
  const blockedReasons: PromotionBlockReason[] = [];
  
  // Check model
  const model = await MLModelVersionModel.findOne({ modelId }).lean();
  
  if (!model) {
    blockedReasons.push({ code: 'MODEL_NOT_FOUND', message: 'Model not found' });
  } else if (model.status !== 'APPROVED') {
    blockedReasons.push({ code: 'MODEL_NOT_APPROVED', message: `Status: ${model.status}` });
  }
  
  // Check config
  const config = await getSelfLearningConfig();
  if (!config.selfLearningEnabled) {
    blockedReasons.push({ code: 'KILL_SWITCH_ACTIVE', message: 'Self-learning disabled' });
  }
  
  // Check drift
  const guardSnapshot = await canRetrain(horizon);
  if (guardSnapshot.driftGuard?.level === 'CRITICAL') {
    blockedReasons.push({ code: 'DRIFT_CRITICAL', message: 'Drift level CRITICAL' });
  }
  
  // Check cooldown
  const pointer = await getPointer(horizon);
  if (pointer.switchedAt) {
    const hoursSinceSwitch = (Date.now() - pointer.switchedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceSwitch < PROMOTION_COOLDOWN_HOURS) {
      blockedReasons.push({ 
        code: 'COOLDOWN_NOT_PASSED', 
        message: `${hoursSinceSwitch.toFixed(1)}h / ${PROMOTION_COOLDOWN_HOURS}h` 
      });
    }
  }
  
  return {
    canPromote: blockedReasons.length === 0,
    blockedReasons,
  };
}

/**
 * Get promotion status summary
 */
export async function getPromotionStatus(horizon: '7d' | '30d') {
  const pointer = await getPointer(horizon);
  const activeModel = pointer.activeModelId
    ? await MLModelVersionModel.findOne({ modelId: pointer.activeModelId }).lean()
    : null;
  
  // Count approved candidates waiting
  const approvedCount = await MLModelVersionModel.countDocuments({
    horizon,
    status: 'APPROVED',
  });
  
  // Check if can promote
  let canPromoteNow = false;
  let blockedReasons: string[] = [];
  
  if (approvedCount > 0) {
    const latestApproved = await MLModelVersionModel.findOne({
      horizon,
      status: 'APPROVED',
    }).sort({ trainedAt: -1 }).lean();
    
    if (latestApproved) {
      const check = await canPromote(latestApproved.modelId, horizon);
      canPromoteNow = check.canPromote;
      blockedReasons = check.blockedReasons.map(r => r.message);
    }
  }
  
  return {
    horizon,
    activeModelId: pointer.activeModelId,
    previousModelId: pointer.previousModelId,
    activeModel: activeModel ? {
      modelId: activeModel.modelId,
      trainedAt: activeModel.trainedAt,
      activatedAt: activeModel.activatedAt,
      precision: activeModel.trainMetrics?.precision,
    } : null,
    lastSwitchAt: pointer.switchedAt,
    lastSwitchBy: pointer.switchedBy,
    rollbackCount: pointer.rollbackCount,
    approvedCandidatesWaiting: approvedCount,
    canPromoteNow,
    blockedReasons,
  };
}
