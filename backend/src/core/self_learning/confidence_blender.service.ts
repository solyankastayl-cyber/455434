/**
 * Confidence Blender Service (ETAP 5.8)
 * 
 * Blends ML prediction confidence with rules confidence.
 * ML influences confidence, NOT score/bucket.
 * 
 * INVARIANTS:
 * - Score and bucket are NEVER modified by ML
 * - finalConfidence is clamped to [0, 100]
 * - High drift reduces ML influence (safety)
 * - ML service down = no impact (mlModifier = 1.0)
 * - Confidence is monotonic: higher pSuccess → not lower confidence (same drift)
 */
import { getActiveModelId } from './active_model_pointer.model.js';
import { getSelfLearningConfig } from './self_learning_config.model.js';
import { logSelfLearningEvent } from './audit_helpers.js';
import axios from 'axios';

// ==================== CONSTANTS ====================

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8003';

// Drift modifiers (from LI-5)
const DRIFT_MODIFIERS = {
  LOW: 1.0,
  MEDIUM: 0.85,
  HIGH: 0.6,
  CRITICAL: 0.3,
} as const;

// ML modifier range
const ML_MODIFIER_MIN = 0.4;
const ML_MODIFIER_MAX = 1.0;

// ==================== TYPES ====================

export type DriftLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface BlendRequest {
  baseConfidence: number;       // Rules confidence (0-100)
  pSuccess: number | null;      // ML prediction P(success) (0-1), null if unavailable
  driftLevel: DriftLevel;       // Current drift level
  horizon: '7d' | '30d';
}

export interface BlendResult {
  finalConfidence: number;      // Final blended confidence (0-100)
  components: {
    baseConfidence: number;
    mlModifier: number;
    driftModifier: number;
    pSuccess: number | null;
  };
  applied: boolean;             // Whether ML was actually applied
  reason: string;
}

// ==================== BLENDING LOGIC ====================

/**
 * Blend ML confidence with rules confidence
 * 
 * Formula:
 *   mlModifier = clamp(0.7 + 0.6 * (pSuccess - 0.5), ML_MODIFIER_MIN, ML_MODIFIER_MAX)
 *   driftModifier = DRIFT_MODIFIERS[driftLevel]
 *   finalConfidence = clamp(baseConfidence * mlModifier * driftModifier, 0, 100)
 * 
 * Safety gates:
 *   - If drift HIGH/CRITICAL → mlModifier = 1.0 (ML doesn't boost)
 *   - If pSuccess null (ML unavailable) → mlModifier = 1.0
 *   - If self-learning disabled → mlModifier = 1.0
 */
export function blend(request: BlendRequest): BlendResult {
  const { baseConfidence, pSuccess, driftLevel, horizon } = request;
  
  // Get drift modifier
  const driftModifier = DRIFT_MODIFIERS[driftLevel];
  
  // Safety: If drift is HIGH/CRITICAL, ML cannot boost confidence
  const isHighDrift = driftLevel === 'HIGH' || driftLevel === 'CRITICAL';
  
  // Calculate ML modifier
  let mlModifier = 1.0;
  let applied = false;
  let reason = '';
  
  if (pSuccess === null) {
    // ML unavailable
    reason = 'ML prediction unavailable';
  } else if (isHighDrift) {
    // High drift: ML can only reduce, not boost
    const rawModifier = 0.7 + 0.6 * (pSuccess - 0.5);
    mlModifier = Math.min(1.0, rawModifier); // Cap at 1.0 (no boost)
    applied = true;
    reason = `High drift (${driftLevel}): ML capped at 1.0`;
  } else {
    // Normal: Apply full ML modifier
    mlModifier = clamp(0.7 + 0.6 * (pSuccess - 0.5), ML_MODIFIER_MIN, ML_MODIFIER_MAX);
    applied = true;
    reason = 'ML modifier applied';
  }
  
  // Calculate final confidence
  const finalConfidence = clamp(baseConfidence * mlModifier * driftModifier, 0, 100);
  
  return {
    finalConfidence,
    components: {
      baseConfidence,
      mlModifier,
      driftModifier,
      pSuccess,
    },
    applied,
    reason,
  };
}

/**
 * Get shadow prediction from ML service
 */
export async function getShadowPrediction(
  features: Record<string, number>,
  horizon: '7d' | '30d'
): Promise<{ pSuccess: number | null; error?: string }> {
  try {
    // Check if we have an active model
    const activeModelId = await getActiveModelId(horizon);
    
    if (!activeModelId) {
      return { pSuccess: null, error: 'No active model' };
    }
    
    // Call ML service
    const response = await axios.post(`${ML_SERVICE_URL}/predict`, {
      features: [features],
      horizon,
    }, {
      timeout: 5000, // 5s timeout
    });
    
    if (response.data?.predictions?.length > 0) {
      return { pSuccess: response.data.predictions[0].p_success };
    }
    
    return { pSuccess: null, error: 'No prediction returned' };
    
  } catch (error: any) {
    console.warn(`[ConfidenceBlender] ML service error: ${error.message}`);
    return { pSuccess: null, error: error.message };
  }
}

/**
 * Full confidence calculation with ML integration
 */
export async function calculateFinalConfidence(
  baseConfidence: number,
  features: Record<string, number>,
  driftLevel: DriftLevel,
  horizon: '7d' | '30d'
): Promise<BlendResult> {
  // Check if self-learning is enabled
  const config = await getSelfLearningConfig();
  
  if (!config.selfLearningEnabled) {
    return blend({
      baseConfidence,
      pSuccess: null,
      driftLevel,
      horizon,
    });
  }
  
  // Get shadow prediction
  const { pSuccess, error } = await getShadowPrediction(features, horizon);
  
  if (error) {
    console.warn(`[ConfidenceBlender] Using base confidence (ML error: ${error})`);
  }
  
  return blend({
    baseConfidence,
    pSuccess,
    driftLevel,
    horizon,
  });
}

/**
 * Get current ML modifier for horizon
 */
export async function getCurrentMlModifier(horizon: '7d' | '30d'): Promise<{
  hasActiveModel: boolean;
  modelId: string | null;
  defaultModifier: number;
}> {
  const activeModelId = await getActiveModelId(horizon);
  
  return {
    hasActiveModel: activeModelId !== null,
    modelId: activeModelId,
    defaultModifier: 1.0,
  };
}

/**
 * Get blending configuration
 */
export function getBlendingConfig() {
  return {
    driftModifiers: DRIFT_MODIFIERS,
    mlModifierRange: {
      min: ML_MODIFIER_MIN,
      max: ML_MODIFIER_MAX,
    },
    formula: 'finalConfidence = baseConfidence × mlModifier × driftModifier',
    mlModifierFormula: 'mlModifier = clamp(0.7 + 0.6 × (pSuccess - 0.5), 0.4, 1.0)',
    safetyGates: [
      'HIGH/CRITICAL drift: ML modifier capped at 1.0 (no boost)',
      'ML unavailable: modifier = 1.0 (no impact)',
      'Self-learning disabled: modifier = 1.0 (no impact)',
    ],
  };
}

// ==================== HELPERS ====================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
