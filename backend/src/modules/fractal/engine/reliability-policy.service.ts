/**
 * BLOCK 38.5 — Reliability Policy Service
 * 
 * Policy engine that determines actions based on reliability state:
 * - Confidence modifiers
 * - Threshold raising
 * - Freeze decisions
 */

import {
  ReliabilityPolicyConfig,
  ReliabilityPolicyAction,
  ReliabilityState,
  DEFAULT_RELIABILITY_POLICY_CONFIG,
} from '../contracts/reliability-policy.contracts.js';
import { ReliabilityResult } from '../contracts/reliability.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Modifier Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Get confidence modifier based on reliability badge
 */
export function getModifierFromBadge(
  badge: ReliabilityResult['badge'],
  cfg: ReliabilityPolicyConfig = DEFAULT_RELIABILITY_POLICY_CONFIG
): number {
  switch (badge) {
    case 'OK': return cfg.okMul;
    case 'WARN': return cfg.warnMul;
    case 'DEGRADED': return cfg.degradedMul;
    case 'CRITICAL': return cfg.criticalMul;
    default: return cfg.insufficientMul;
  }
}

/**
 * Get action based on reliability badge
 */
export function getActionFromBadge(
  badge: ReliabilityResult['badge'],
  cfg: ReliabilityPolicyConfig = DEFAULT_RELIABILITY_POLICY_CONFIG
): ReliabilityPolicyAction {
  switch (badge) {
    case 'OK': return 'NONE';
    case 'WARN': return cfg.warnAction;
    case 'DEGRADED': return cfg.degradedAction;
    case 'CRITICAL': return cfg.criticalAction;
    default: return 'DEGRADE_CONFIDENCE';
  }
}

// ═══════════════════════════════════════════════════════════════
// Freeze Logic
// ═══════════════════════════════════════════════════════════════

/**
 * Check if action requires freeze
 */
export function shouldFreeze(action: ReliabilityPolicyAction): boolean {
  return action === 'FREEZE_ENTRIES' || action === 'FREEZE_ALL';
}

/**
 * Check if signal should be blocked
 */
export function shouldBlockSignal(
  state: ReliabilityState,
  positionSide: 'LONG' | 'SHORT' | 'FLAT',
  signalConfidence: number,
  cfg: ReliabilityPolicyConfig = DEFAULT_RELIABILITY_POLICY_CONFIG
): { blocked: boolean; reason?: string } {
  const now = Date.now();
  const frozen = state.frozenUntilTs && state.frozenUntilTs > now;
  
  if (!frozen) {
    return { blocked: false };
  }
  
  // FREEZE_ALL: block everything
  if (state.action === 'FREEZE_ALL') {
    return { blocked: true, reason: 'FREEZE_ALL_ACTIVE' };
  }
  
  // FREEZE_ENTRIES: block new entries only
  if (state.action === 'FREEZE_ENTRIES') {
    if (positionSide === 'FLAT') {
      // Allow super-strong signals even when frozen
      if (signalConfidence >= cfg.minEnterConfidenceWhenFrozen) {
        return { blocked: false };
      }
      return { blocked: true, reason: 'FREEZE_ENTRIES_LOW_CONF' };
    }
  }
  
  return { blocked: false };
}

// ═══════════════════════════════════════════════════════════════
// Threshold Raising
// ═══════════════════════════════════════════════════════════════

export interface RaisedThresholds {
  minSimilarity: number;
  minMatches: number;
  minConsensus: number;
}

/**
 * Get raised thresholds when RAISE_THRESHOLDS action is active
 */
export function getRaisedThresholds(
  baseThresholds: { minSimilarity: number; minMatches: number; minConsensus: number },
  action: ReliabilityPolicyAction,
  cfg: ReliabilityPolicyConfig = DEFAULT_RELIABILITY_POLICY_CONFIG
): RaisedThresholds {
  if (action !== 'RAISE_THRESHOLDS') {
    return baseThresholds;
  }
  
  return {
    minSimilarity: baseThresholds.minSimilarity + cfg.raisedMinSimilarity,
    minMatches: baseThresholds.minMatches + cfg.raisedMinMatches,
    minConsensus: Math.max(baseThresholds.minConsensus, cfg.raisedMinConsensus),
  };
}

// ═══════════════════════════════════════════════════════════════
// Full State Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Build full reliability state from components
 */
export function buildReliabilityState(
  reliabilityResult: ReliabilityResult,
  previousState: ReliabilityState | null,
  cfg: ReliabilityPolicyConfig = DEFAULT_RELIABILITY_POLICY_CONFIG
): ReliabilityState {
  const { badge, reliability, components, notes } = reliabilityResult;
  
  const modifier = getModifierFromBadge(badge, cfg);
  const action = getActionFromBadge(badge, cfg);
  
  // Build reasons from components
  const reasons: string[] = [];
  if (components.driftHealth < 0.5) reasons.push('DRIFT_LOW');
  if (components.calibrationHealth < 0.5) reasons.push('CAL_LOW');
  if (components.rollingHealth < 0.5) reasons.push('ROLLING_LOW');
  if (components.tailRiskHealth < 0.5) reasons.push('MC_TAIL_BAD');
  if (notes) reasons.push(...notes);
  
  const state: ReliabilityState = {
    badge,
    score: reliability,
    modifier,
    action,
    thresholdsRaised: action === 'RAISE_THRESHOLDS',
    reasons,
    updatedAtTs: Date.now(),
  };
  
  // Freeze decision
  if (shouldFreeze(action)) {
    const now = Date.now();
    state.frozenUntilTs = now + cfg.freezeCooldownDays * 24 * 60 * 60 * 1000;
  } else if (previousState?.frozenUntilTs && previousState.frozenUntilTs > Date.now()) {
    // Keep existing freeze if still active
    state.frozenUntilTs = previousState.frozenUntilTs;
  }
  
  return state;
}

// ═══════════════════════════════════════════════════════════════
// Signal Adjustment
// ═══════════════════════════════════════════════════════════════

export interface AdjustedSignal {
  signal: 'LONG' | 'SHORT' | 'NEUTRAL';
  baseConfidence: number;
  finalConfidence: number;
  blocked: boolean;
  blockReason?: string;
  reliabilityState: ReliabilityState;
}

/**
 * Apply reliability policy to signal
 */
export function applyReliabilityPolicy(
  signal: 'LONG' | 'SHORT' | 'NEUTRAL',
  baseConfidence: number,
  reliabilityState: ReliabilityState,
  positionSide: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT',
  cfg: ReliabilityPolicyConfig = DEFAULT_RELIABILITY_POLICY_CONFIG
): AdjustedSignal {
  // Apply confidence modifier
  let finalConfidence = Math.max(0, Math.min(1, baseConfidence * reliabilityState.modifier));
  
  // Check if signal should be blocked
  const blockCheck = shouldBlockSignal(reliabilityState, positionSide, finalConfidence, cfg);
  
  if (blockCheck.blocked) {
    return {
      signal: 'NEUTRAL',
      baseConfidence,
      finalConfidence: 0,
      blocked: true,
      blockReason: blockCheck.reason,
      reliabilityState,
    };
  }
  
  // Check threshold-based blocking
  if (reliabilityState.action === 'RAISE_THRESHOLDS' && finalConfidence < 0.55) {
    return {
      signal: 'NEUTRAL',
      baseConfidence,
      finalConfidence,
      blocked: true,
      blockReason: 'RAISED_THRESHOLD_NOT_MET',
      reliabilityState,
    };
  }
  
  return {
    signal,
    baseConfidence,
    finalConfidence,
    blocked: false,
    reliabilityState,
  };
}
