/**
 * Confidence Adjuster Service
 * 
 * ETAP 5.7: Dynamic ML modifier based on shadow health.
 * 
 * RULES:
 * - mlModifier applied AFTER model score
 * - mlModifier never > 1.0 (never boosts)
 * - mlModifier never == 0 (never fully disables)
 * - degraded ≠ rollback (gradual degradation)
 * 
 * FORMULA:
 * finalScore = baseScore * mlModifier * signalWeight
 * 
 * MODIFIERS:
 * - HEALTHY: 1.0
 * - DEGRADED: 0.6
 * - CRITICAL: 0.3
 */
import { ActiveModelStateModel } from './active_model.state.js';
import { logConfidenceAdjustEvent } from './audit_logger.service.js';
import type { Horizon } from './self_learning.types.js';

// ==================== CONSTANTS ====================

export const CONFIDENCE_MODIFIERS = {
  HEALTHY: 1.0,
  DEGRADED: 0.6,
  CRITICAL: 0.3,
} as const;

// Clamp range for safety
export const ML_MODIFIER_MIN = 0.1; // Never fully disable
export const ML_MODIFIER_MAX = 1.0; // Never boost

// ==================== TYPES ====================

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export interface ConfidenceAdjustment {
  baseScore: number;
  mlModifier: number;
  finalScore: number;
  healthStatus: HealthStatus;
  reason: string;
}

// ==================== SERVICE ====================

/**
 * Get current ML modifier for horizon
 */
export async function getMLModifier(horizon: Horizon): Promise<{
  modifier: number;
  healthStatus: HealthStatus;
}> {
  const state = await ActiveModelStateModel.getState(horizon);
  
  if (!state) {
    return {
      modifier: CONFIDENCE_MODIFIERS.HEALTHY,
      healthStatus: 'HEALTHY',
    };
  }
  
  const healthStatus = state.healthStatus as HealthStatus;
  const modifier = CONFIDENCE_MODIFIERS[healthStatus] || CONFIDENCE_MODIFIERS.HEALTHY;
  
  return {
    modifier: clampModifier(modifier),
    healthStatus,
  };
}

/**
 * Adjust confidence score based on health
 * 
 * This is the main entry point called during inference.
 */
export async function adjustConfidence(
  horizon: Horizon,
  baseScore: number,
  modelVersionId?: string
): Promise<ConfidenceAdjustment> {
  const { modifier, healthStatus } = await getMLModifier(horizon);
  const finalScore = clampModifier(baseScore * modifier);
  
  // Build reason
  let reason = `Health: ${healthStatus}, modifier: ${modifier}`;
  if (healthStatus !== 'HEALTHY') {
    reason = `Confidence reduced due to ${healthStatus} status`;
  }
  
  return {
    baseScore,
    mlModifier: modifier,
    finalScore,
    healthStatus,
    reason,
  };
}

/**
 * Set health status and update modifier
 * 
 * Called by shadow monitor when health changes.
 */
export async function updateHealthAndModifier(
  horizon: Horizon,
  healthStatus: HealthStatus,
  modelVersionId: string
): Promise<{
  previousModifier: number;
  newModifier: number;
}> {
  const previousState = await ActiveModelStateModel.getState(horizon);
  const previousModifier = previousState 
    ? CONFIDENCE_MODIFIERS[previousState.healthStatus as HealthStatus] || 1.0
    : 1.0;
  
  await ActiveModelStateModel.updateHealth(horizon, healthStatus);
  
  const newModifier = CONFIDENCE_MODIFIERS[healthStatus];
  
  // Log if modifier changed
  if (previousModifier !== newModifier) {
    await logConfidenceAdjustEvent(
      horizon,
      modelVersionId,
      newModifier,
      healthStatus,
      previousModifier
    );
  }
  
  return {
    previousModifier,
    newModifier,
  };
}

/**
 * Clamp modifier to valid range
 */
function clampModifier(value: number): number {
  return Math.max(ML_MODIFIER_MIN, Math.min(ML_MODIFIER_MAX, value));
}

/**
 * Calculate final confidence with all modifiers
 * 
 * Full formula:
 * finalConfidence = ruleConfidence * driftModifier * mlModifier
 */
export function calculateFinalConfidence(
  ruleConfidence: number,
  driftModifier: number,
  mlModifier: number
): number {
  const raw = ruleConfidence * driftModifier * mlModifier;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

/**
 * Get confidence breakdown for debugging/audit
 */
export async function getConfidenceBreakdown(
  horizon: Horizon,
  ruleConfidence: number,
  driftModifier: number
): Promise<{
  ruleConfidence: number;
  driftModifier: number;
  mlModifier: number;
  healthStatus: HealthStatus;
  finalConfidence: number;
  breakdown: string;
}> {
  const { modifier, healthStatus } = await getMLModifier(horizon);
  const finalConfidence = calculateFinalConfidence(ruleConfidence, driftModifier, modifier);
  
  return {
    ruleConfidence,
    driftModifier,
    mlModifier: modifier,
    healthStatus,
    finalConfidence,
    breakdown: `${ruleConfidence} × ${driftModifier} × ${modifier} = ${finalConfidence}`,
  };
}

/**
 * Simulate confidence adjustment (for testing)
 */
export function simulateAdjustment(
  baseScore: number,
  healthStatus: HealthStatus
): ConfidenceAdjustment {
  const modifier = CONFIDENCE_MODIFIERS[healthStatus];
  const finalScore = clampModifier(baseScore * modifier);
  
  return {
    baseScore,
    mlModifier: modifier,
    finalScore,
    healthStatus,
    reason: `Simulated adjustment for ${healthStatus} status`,
  };
}
