/**
 * Evaluation Policy
 * 
 * ETAP 5.4: Formalized rules for PROMOTE / HOLD / REJECT decisions.
 * 
 * Hard rules:
 * - PROMOTE only if better than active
 * - HOLD if neutral but stable
 * - REJECT on any degradation or instability
 */
import type { Horizon } from './self_learning.types.js';
import { diffMetrics, percentChange } from './metric_diff.util.js';

// ==================== TYPES ====================

export type EvaluationDecision = 'PROMOTE' | 'HOLD' | 'REJECT';

export interface EvaluationPolicy {
  // Minimum improvement required for PROMOTE
  minPrecisionImprovement: number; // e.g., 0.02 = +2%
  minLiftImprovement: number; // e.g., 0.05 = +5%
  
  // Maximum degradation allowed
  maxFPRIncrease: number; // e.g., 0.02 = +2%
  maxECEIncrease: number; // e.g., 0.02
  maxPrecisionDrop: number; // e.g., 0.02 = -2%
  
  // Stability
  stabilityThreshold: number; // Minimum sample count
}

export interface PolicyEvaluationResult {
  decision: EvaluationDecision;
  reasons: string[];
  checks: {
    precisionImproved: boolean;
    liftImproved: boolean;
    fprAcceptable: boolean;
    eceAcceptable: boolean;
    precisionStable: boolean;
    hasEnoughSamples: boolean;
  };
  deltas: Record<string, number>;
}

// ==================== DEFAULT POLICY ====================

export const DEFAULT_POLICY: EvaluationPolicy = {
  minPrecisionImprovement: 0.02, // +2%
  minLiftImprovement: 0.05, // +5%
  maxFPRIncrease: 0.02, // +2%
  maxECEIncrease: 0.02,
  maxPrecisionDrop: 0.02, // -2%
  stabilityThreshold: 50,
};

// ==================== POLICY APPLICATION ====================

/**
 * Apply evaluation policy
 * 
 * Decision logic:
 * 
 * PROMOTE if ALL:
 *   - Precision not degraded (drop < maxPrecisionDrop)
 *   - FPR not degraded (increase < maxFPRIncrease)
 *   - ECE not degraded (increase < maxECEIncrease)
 *   - AND (precision +2% OR lift +5%)
 * 
 * REJECT if ANY:
 *   - Precision dropped > maxPrecisionDrop
 *   - FPR increased > maxFPRIncrease
 *   - ECE degraded significantly
 * 
 * HOLD otherwise:
 *   - Not enough improvement to promote
 *   - But not bad enough to reject
 */
export function applyPolicy(
  candidate: Record<string, number>,
  baseline: Record<string, number>,
  policy: EvaluationPolicy = DEFAULT_POLICY,
  sampleCount: number = 0
): PolicyEvaluationResult {
  const deltas = diffMetrics(candidate, baseline);
  const reasons: string[] = [];
  
  // ==================== CHECKS ====================
  
  // Precision check
  const precisionDelta = deltas.precision || 0;
  const precisionImproved = precisionDelta >= policy.minPrecisionImprovement;
  const precisionStable = precisionDelta >= -policy.maxPrecisionDrop;
  
  // Lift check
  const liftDelta = deltas.lift || 0;
  const liftImproved = liftDelta >= policy.minLiftImprovement;
  
  // FPR check (lower is better)
  const fprDelta = deltas.falseBuyRate || deltas.fpr || 0;
  const fprAcceptable = fprDelta <= policy.maxFPRIncrease;
  
  // ECE check (lower is better)
  const eceDelta = deltas.ece || 0;
  const eceAcceptable = eceDelta <= policy.maxECEIncrease;
  
  // Sample count check
  const hasEnoughSamples = sampleCount >= policy.stabilityThreshold;
  
  // ==================== DECISION ====================
  
  let decision: EvaluationDecision = 'HOLD';
  
  // REJECT conditions (any triggers rejection)
  if (!precisionStable) {
    decision = 'REJECT';
    reasons.push(`Precision dropped ${(precisionDelta * 100).toFixed(1)}% (max allowed: ${(policy.maxPrecisionDrop * 100).toFixed(1)}%)`);
  }
  
  if (!fprAcceptable) {
    decision = 'REJECT';
    reasons.push(`FPR increased ${(fprDelta * 100).toFixed(1)}% (max allowed: ${(policy.maxFPRIncrease * 100).toFixed(1)}%)`);
  }
  
  if (!eceAcceptable) {
    decision = 'REJECT';
    reasons.push(`ECE degraded by ${eceDelta.toFixed(4)} (max allowed: ${policy.maxECEIncrease})`);
  }
  
  // If not rejected, check for PROMOTE
  if (decision !== 'REJECT') {
    // Must pass stability checks AND have improvement
    if (precisionStable && fprAcceptable && eceAcceptable) {
      if (precisionImproved || liftImproved) {
        if (!hasEnoughSamples) {
          decision = 'HOLD';
          reasons.push(`Insufficient samples: ${sampleCount} < ${policy.stabilityThreshold}`);
        } else {
          decision = 'PROMOTE';
          if (precisionImproved) {
            reasons.push(`Precision improved by ${(precisionDelta * 100).toFixed(1)}%`);
          }
          if (liftImproved) {
            reasons.push(`Lift improved by ${(liftDelta * 100).toFixed(1)}%`);
          }
        }
      } else {
        decision = 'HOLD';
        reasons.push('No significant improvement over baseline');
      }
    }
  }
  
  // Add summary reason if HOLD
  if (decision === 'HOLD' && reasons.length === 0) {
    reasons.push('Model is stable but no clear improvement');
  }
  
  return {
    decision,
    reasons,
    checks: {
      precisionImproved,
      liftImproved,
      fprAcceptable,
      eceAcceptable,
      precisionStable,
      hasEnoughSamples,
    },
    deltas,
  };
}

/**
 * Get policy description
 */
export function describePolicyThresholds(policy: EvaluationPolicy = DEFAULT_POLICY): string[] {
  return [
    `PROMOTE requires: precision +${(policy.minPrecisionImprovement * 100).toFixed(0)}% OR lift +${(policy.minLiftImprovement * 100).toFixed(0)}%`,
    `REJECT if: precision -${(policy.maxPrecisionDrop * 100).toFixed(0)}% OR FPR +${(policy.maxFPRIncrease * 100).toFixed(0)}% OR ECE +${policy.maxECEIncrease}`,
    `Minimum samples: ${policy.stabilityThreshold}`,
  ];
}
