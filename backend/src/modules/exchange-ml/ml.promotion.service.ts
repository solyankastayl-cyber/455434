/**
 * ML Promotion Service
 * 
 * Manages ML model promotion state and policy.
 * Single source of truth for:
 * - Current mode (OFF/SHADOW/ACTIVE_SAFE)
 * - Active/Candidate models
 * - Promotion policy (regime caps, bounds)
 */

import {
  PromotionState,
  PromotionPolicy,
  MlMode,
  PromotionScope,
  DEFAULT_PROMOTION_STATE,
  DEFAULT_PROMOTION_POLICY,
} from './contracts/mlops.promotion.types.js';

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY STATE (will be persisted to MongoDB in production)
// ═══════════════════════════════════════════════════════════════

let promotionState: PromotionState = { ...DEFAULT_PROMOTION_STATE };

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function nowIso(): string {
  return new Date().toISOString();
}

// ═══════════════════════════════════════════════════════════════
// PROMOTION SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export class MlPromotionService {
  
  /**
   * Get current promotion state
   */
  async getState(): Promise<PromotionState> {
    return { ...promotionState };
  }

  /**
   * Set ML mode (OFF/SHADOW/ACTIVE_SAFE)
   */
  async setMode(mode: MlMode, updatedBy?: string): Promise<PromotionState> {
    promotionState = {
      ...promotionState,
      mode,
      updatedAt: nowIso(),
      updatedBy,
    };
    
    console.log(`[MLOps] Mode changed to ${mode} by ${updatedBy || 'system'}`);
    
    return { ...promotionState };
  }

  /**
   * Update promotion policy
   */
  async updatePolicy(patch: Partial<PromotionPolicy>, updatedBy?: string): Promise<PromotionState> {
    promotionState = {
      ...promotionState,
      policy: {
        ...promotionState.policy,
        ...patch,
        // Keep locked rules
        applyOnlyWhenLive: true,
        neverFlipDecision: true,
        respectMacroBlocks: true,
      },
      updatedAt: nowIso(),
      updatedBy,
    };
    
    console.log(`[MLOps] Policy updated by ${updatedBy || 'system'}`);
    
    return { ...promotionState };
  }

  /**
   * Set candidate model for evaluation
   */
  async setCandidate(candidateId: string, updatedBy?: string): Promise<PromotionState> {
    promotionState = {
      ...promotionState,
      candidateModelId: candidateId,
      updatedAt: nowIso(),
      updatedBy,
    };
    
    console.log(`[MLOps] Candidate set: ${candidateId}`);
    
    return { ...promotionState };
  }

  /**
   * Promote candidate to ACTIVE_SAFE
   * 
   * RULES:
   * - Previous active becomes previousActiveModelId (for rollback)
   * - Mode switches to ACTIVE_SAFE
   * - Candidate is cleared
   */
  async promoteCandidate(
    candidateId: string, 
    reason: string,
    scope: PromotionScope[] = ['CONFIDENCE'],
    updatedBy?: string
  ): Promise<PromotionState> {
    const previousActive = promotionState.activeModelId;
    
    promotionState = {
      ...promotionState,
      previousActiveModelId: previousActive,
      activeModelId: candidateId,
      candidateModelId: undefined,
      scope,
      mode: 'ACTIVE_SAFE',
      updatedAt: nowIso(),
      updatedBy,
    };
    
    console.log(`[MLOps] Promoted ${candidateId} to ACTIVE_SAFE (previous: ${previousActive}). Reason: ${reason}`);
    
    return { ...promotionState };
  }

  /**
   * Rollback to previous active model
   */
  async rollback(reason: string, updatedBy?: string): Promise<PromotionState> {
    const rollbackTo = promotionState.previousActiveModelId || promotionState.activeModelId;
    const rolledBackFrom = promotionState.activeModelId;
    
    promotionState = {
      ...promotionState,
      activeModelId: rollbackTo,
      candidateModelId: undefined,
      mode: 'SHADOW', // Safe mode after rollback
      updatedAt: nowIso(),
      updatedBy,
    };
    
    console.log(`[MLOps] Rollback from ${rolledBackFrom} to ${rollbackTo}. Reason: ${reason}`);
    
    return { ...promotionState };
  }

  /**
   * Get current policy
   */
  async getPolicy(): Promise<PromotionPolicy> {
    return { ...promotionState.policy };
  }

  /**
   * Reset to defaults (for testing)
   */
  async reset(): Promise<PromotionState> {
    promotionState = { ...DEFAULT_PROMOTION_STATE, updatedAt: nowIso() };
    console.log('[MLOps] State reset to defaults');
    return { ...promotionState };
  }
}

// Singleton instance
export const mlPromotionService = new MlPromotionService();

console.log('[MLOps] Promotion service loaded');
