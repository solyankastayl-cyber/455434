/**
 * ML Gate Enforcer (P0.8)
 * 
 * HARD enforcement of quality gates before any ML operation.
 * NO override. NO bypass. NO env flags.
 */

import { FeatureVector } from '../../ml_features_v2/types/feature.types.js';
import { checkGates, GateCheckResult } from '../../ml_quality/gates/index.js';

// ============================================
// Errors
// ============================================

export class MLBlockedError extends Error {
  public readonly blockedBy: string[];
  public readonly qualityScore: number;
  public readonly coverage: number;
  
  constructor(result: GateCheckResult) {
    const reasons = result.decision.blockedBy.join(', ');
    super(`ML operation blocked by quality gates: ${reasons}`);
    this.name = 'MLBlockedError';
    this.blockedBy = result.decision.blockedBy;
    this.qualityScore = result.decision.score;
    this.coverage = result.coverageResult.coverage.coverageRatio;
  }
}

// ============================================
// Gate Enforcer
// ============================================

export interface EnforcementResult {
  allowed: boolean;
  gateResult: GateCheckResult;
}

/**
 * Enforce quality gates before ML operation
 * 
 * @throws {MLBlockedError} if gates fail
 */
export async function enforceGates(vector: FeatureVector): Promise<EnforcementResult> {
  const result = await checkGates(vector);
  
  if (!result.decision.allowed) {
    throw new MLBlockedError(result);
  }
  
  return {
    allowed: true,
    gateResult: result
  };
}

/**
 * Check gates without throwing (for pre-flight checks)
 */
export async function checkGatesPreFlight(vector: FeatureVector): Promise<EnforcementResult> {
  const result = await checkGates(vector);
  
  return {
    allowed: result.decision.allowed,
    gateResult: result
  };
}

/**
 * Enforce gates for training dataset
 * All samples must pass gates
 */
export async function enforceGatesForDataset(
  vectors: FeatureVector[]
): Promise<{
  passed: FeatureVector[];
  blocked: Array<{ vector: FeatureVector; reason: string[] }>;
  passRate: number;
}> {
  const passed: FeatureVector[] = [];
  const blocked: Array<{ vector: FeatureVector; reason: string[] }> = [];
  
  for (const vector of vectors) {
    const result = await checkGates(vector);
    
    if (result.decision.allowed) {
      passed.push(vector);
    } else {
      blocked.push({
        vector,
        reason: result.decision.blockedBy
      });
    }
  }
  
  const passRate = vectors.length > 0 
    ? Math.round((passed.length / vectors.length) * 100) 
    : 0;
  
  return {
    passed,
    blocked,
    passRate
  };
}

/**
 * Minimum pass rate required for training
 * Training will not proceed if pass rate is below this threshold
 */
export const MIN_TRAINING_PASS_RATE = 70;

/**
 * Enforce minimum dataset quality for training
 * 
 * @throws {Error} if pass rate is below minimum
 */
export async function enforceTrainingDatasetQuality(
  vectors: FeatureVector[]
): Promise<{
  validVectors: FeatureVector[];
  passRate: number;
  blockedCount: number;
}> {
  const { passed, blocked, passRate } = await enforceGatesForDataset(vectors);
  
  if (passRate < MIN_TRAINING_PASS_RATE) {
    throw new Error(
      `Training blocked: dataset pass rate ${passRate}% is below minimum ${MIN_TRAINING_PASS_RATE}%. ` +
      `${blocked.length} of ${vectors.length} samples blocked by quality gates.`
    );
  }
  
  return {
    validVectors: passed,
    passRate,
    blockedCount: blocked.length
  };
}
