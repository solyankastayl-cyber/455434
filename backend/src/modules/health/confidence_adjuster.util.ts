/**
 * P5.1 — Confidence Adjustment Layer
 * 
 * Applies health-based confidence modifiers to all asset builders.
 * 
 * Rules:
 * - HEALTHY:  modifier = 1.0
 * - DEGRADED: modifier = 0.6
 * - CRITICAL: modifier = 0.3
 * 
 * finalConfidence = clamp01(baseConfidence * driftModifier)
 */

export type HealthGrade = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export interface ConfidenceBlock {
  base: number;
  modifier: number;
  final: number;
  healthGrade: HealthGrade;
  reasons?: string[];
}

/**
 * Get drift modifier based on health grade
 */
export function getDriftModifier(grade: HealthGrade): number {
  switch (grade) {
    case 'HEALTHY': return 1.0;
    case 'DEGRADED': return 0.6;
    case 'CRITICAL': return 0.3;
    default: return 1.0;
  }
}

/**
 * Clamp value to [0, 1] range
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Apply confidence adjustment based on health grade
 * 
 * @param base - Base confidence value (0-1)
 * @param grade - Current health grade
 * @param reasons - Optional reasons array for INSUFFICIENT_SAMPLES gate
 * @returns ConfidenceBlock with adjusted confidence
 */
export function applyConfidenceAdjustment(
  base: number,
  grade: HealthGrade,
  reasons?: string[]
): ConfidenceBlock {
  const modifier = getDriftModifier(grade);
  const final = clamp01(base * modifier);
  
  // Round to 4 decimal places
  return {
    base: Math.round(base * 10000) / 10000,
    modifier,
    final: Math.round(final * 10000) / 10000,
    healthGrade: grade,
    reasons,
  };
}

/**
 * Check if reasons contain INSUFFICIENT_SAMPLES
 * In this case, grade should be HEALTHY and modifier = 1.0
 */
export function hasInsufficientSamples(reasons: string[]): boolean {
  return reasons.some(r => r.includes('INSUFFICIENT_SAMPLES'));
}

/**
 * Get confidence block with INSUFFICIENT_SAMPLES handling
 */
export function getConfidenceWithSamplesGate(
  base: number,
  grade: HealthGrade,
  reasons: string[]
): ConfidenceBlock {
  // If insufficient samples, treat as HEALTHY with gate info
  if (hasInsufficientSamples(reasons)) {
    return {
      base: Math.round(base * 10000) / 10000,
      modifier: 1.0,
      final: Math.round(base * 10000) / 10000,
      healthGrade: 'HEALTHY',
      reasons: ['INSUFFICIENT_SAMPLES gate active'],
    };
  }
  
  return applyConfidenceAdjustment(base, grade, reasons);
}

export default {
  getDriftModifier,
  applyConfidenceAdjustment,
  hasInsufficientSamples,
  getConfidenceWithSamplesGate,
};
