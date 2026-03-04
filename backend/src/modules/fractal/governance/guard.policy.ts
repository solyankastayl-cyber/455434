/**
 * BLOCK 47.6 — Protection Policy
 * Defines what changes when in PROTECTION_MODE
 */

import { GovernanceMode } from './guard.types.js';

// ═══════════════════════════════════════════════════════════════
// POLICY OVERRIDES
// ═══════════════════════════════════════════════════════════════

export interface ProtectionOverrides {
  minEnterConfidenceAdd: number;     // +0.10 in PROTECTION
  minReliabilityAdd: number;         // +0.10 in PROTECTION
  maxExposureMultiplier: number;     // 0.6 in PROTECTION
  frozenPresetOnly: boolean;         // true in FROZEN_ONLY
  allowNewTrades: boolean;           // false in HALT_TRADING
  entropyHardLimit: number;          // lower in PROTECTION
}

export const DEFAULT_OVERRIDES: Record<GovernanceMode, ProtectionOverrides> = {
  NORMAL: {
    minEnterConfidenceAdd: 0,
    minReliabilityAdd: 0,
    maxExposureMultiplier: 1.0,
    frozenPresetOnly: false,
    allowNewTrades: true,
    entropyHardLimit: 0.8,
  },
  PROTECTION_MODE: {
    minEnterConfidenceAdd: 0.10,
    minReliabilityAdd: 0.10,
    maxExposureMultiplier: 0.6,
    frozenPresetOnly: false,
    allowNewTrades: true,
    entropyHardLimit: 0.65,
  },
  FROZEN_ONLY: {
    minEnterConfidenceAdd: 0.15,
    minReliabilityAdd: 0.15,
    maxExposureMultiplier: 0.4,
    frozenPresetOnly: true,
    allowNewTrades: true,
    entropyHardLimit: 0.5,
  },
  HALT_TRADING: {
    minEnterConfidenceAdd: 1.0,       // effectively blocks all
    minReliabilityAdd: 1.0,
    maxExposureMultiplier: 0,
    frozenPresetOnly: true,
    allowNewTrades: false,
    entropyHardLimit: 0,
  },
};

// ═══════════════════════════════════════════════════════════════
// GET ACTIVE POLICY
// ═══════════════════════════════════════════════════════════════

export function getProtectionPolicy(mode: GovernanceMode): ProtectionOverrides {
  return DEFAULT_OVERRIDES[mode] || DEFAULT_OVERRIDES.NORMAL;
}

// ═══════════════════════════════════════════════════════════════
// APPLY POLICY TO SIGNAL
// ═══════════════════════════════════════════════════════════════

export interface SignalWithPolicy {
  originalConfidence: number;
  adjustedConfidence: number;
  originalExposure: number;
  adjustedExposure: number;
  blocked: boolean;
  blockReason?: string;
}

export function applyPolicyToSignal(
  mode: GovernanceMode,
  signal: { confidence: number; reliability: number; exposure: number; entropy: number },
  baseThresholds: { minConfidence: number; minReliability: number }
): SignalWithPolicy {
  const policy = getProtectionPolicy(mode);
  
  const adjustedMinConf = baseThresholds.minConfidence + policy.minEnterConfidenceAdd;
  const adjustedMinRel = baseThresholds.minReliability + policy.minReliabilityAdd;
  
  // Check if blocked
  let blocked = false;
  let blockReason: string | undefined;
  
  if (!policy.allowNewTrades) {
    blocked = true;
    blockReason = 'HALT_TRADING mode - no new trades allowed';
  } else if (signal.confidence < adjustedMinConf) {
    blocked = true;
    blockReason = `Confidence ${signal.confidence.toFixed(2)} below adjusted threshold ${adjustedMinConf.toFixed(2)}`;
  } else if (signal.reliability < adjustedMinRel) {
    blocked = true;
    blockReason = `Reliability ${signal.reliability.toFixed(2)} below adjusted threshold ${adjustedMinRel.toFixed(2)}`;
  } else if (signal.entropy > policy.entropyHardLimit) {
    blocked = true;
    blockReason = `Entropy ${signal.entropy.toFixed(2)} above hard limit ${policy.entropyHardLimit.toFixed(2)}`;
  }
  
  // Adjust exposure
  const adjustedExposure = blocked ? 0 : signal.exposure * policy.maxExposureMultiplier;
  
  return {
    originalConfidence: signal.confidence,
    adjustedConfidence: blocked ? 0 : signal.confidence,
    originalExposure: signal.exposure,
    adjustedExposure,
    blocked,
    blockReason,
  };
}
