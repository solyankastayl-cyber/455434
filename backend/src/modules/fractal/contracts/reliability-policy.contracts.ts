/**
 * BLOCK 38.5 — Reliability Policy Contracts
 * 
 * Policy actions based on reliability state:
 * - NONE: normal operation
 * - DEGRADE_CONFIDENCE: reduce confidence multiplier
 * - RAISE_THRESHOLDS: increase entry requirements
 * - FREEZE_ENTRIES: block new positions
 * - FREEZE_ALL: force all signals to NEUTRAL
 */

export type ReliabilityPolicyAction =
  | 'NONE'
  | 'DEGRADE_CONFIDENCE'
  | 'RAISE_THRESHOLDS'
  | 'FREEZE_ENTRIES'
  | 'FREEZE_ALL';

export interface ReliabilityPolicyConfig {
  // Modifier mapping by badge
  okMul: number;           // 1.00
  warnMul: number;         // 0.85
  degradedMul: number;     // 0.60
  criticalMul: number;     // 0.30
  insufficientMul: number; // 0.90

  // Actions by badge
  warnAction: ReliabilityPolicyAction;
  degradedAction: ReliabilityPolicyAction;
  criticalAction: ReliabilityPolicyAction;

  // Freeze behavior
  freezeCooldownDays: number;      // 14
  minEnterConfidenceWhenFrozen: number; // 0.75 - only super strong signals allowed
  
  // Threshold raising
  raisedMinSimilarity: number;     // +0.05 above normal
  raisedMinMatches: number;        // +3 above normal
  raisedMinConsensus: number;      // 0.70
}

export interface ReliabilityState {
  badge: 'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL' | 'INSUFFICIENT_DATA';
  score: number;              // 0..1
  modifier: number;           // 0..1
  action: ReliabilityPolicyAction;
  frozenUntilTs?: number;     // timestamp if freeze active
  thresholdsRaised: boolean;
  reasons: string[];          // ["DRIFT_WARN", "CAL_ECE_HIGH", "MC_P95DD_BAD"]
  updatedAtTs: number;
}

export const DEFAULT_RELIABILITY_POLICY_CONFIG: ReliabilityPolicyConfig = {
  okMul: 1.00,
  warnMul: 0.85,
  degradedMul: 0.60,
  criticalMul: 0.30,
  insufficientMul: 0.90,
  
  warnAction: 'DEGRADE_CONFIDENCE',
  degradedAction: 'RAISE_THRESHOLDS',
  criticalAction: 'FREEZE_ENTRIES',
  
  freezeCooldownDays: 14,
  minEnterConfidenceWhenFrozen: 0.75,
  
  raisedMinSimilarity: 0.05,
  raisedMinMatches: 3,
  raisedMinConsensus: 0.70,
};
