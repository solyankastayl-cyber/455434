/**
 * BLOCK 59.2 — P1.3: Sizing Policy
 * 
 * Dynamic position sizing based on:
 * - Preset (Conservative/Balanced/Aggressive)
 * - Consensus score (agreement multiplier)
 * - Conflict level (penalty multiplier)
 * - Risk factors (tail, entropy, reliability)
 * 
 * Formula:
 * finalSize = baseSize × consensusMultiplier × conflictMultiplier × riskMultiplier
 * 
 * Where:
 * - baseSize: from preset (0.20 / 0.35 / 0.55)
 * - consensusMultiplier: 0.2..1.0 (from consensusToMultiplier)
 * - conflictMultiplier: 0.25..1.0 (from conflictToSizingMultiplier)
 * - riskMultiplier: compound of tail/entropy/reliability penalties
 */

import type { ConsensusResult } from './consensus.index.js';
import { consensusToMultiplier } from './consensus.index.js';
import type { ConflictResult } from './conflict.policy.js';
import { conflictToSizingMultiplier } from './conflict.policy.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type PresetType = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type SizingMode = 'TREND_FOLLOW' | 'COUNTER_TREND' | 'NO_TRADE';

export interface PresetConfig {
  type: PresetType;
  baseSize: number;           // 0..1 base position size
  maxSize: number;            // cap on final size
  minConfidence: number;      // below this → NO_TRADE
  maxEntropy: number;         // above this → NO_TRADE
  maxTailRisk: number;        // above this → NO_TRADE
  minReliability: number;     // below this → reduced size
}

export interface RiskFactors {
  entropy?: number;           // 0..1 market uncertainty
  tailRisk?: number;          // 0..1 (mcP95_DD)
  reliability?: number;       // 0..1 system reliability score
  phaseRisk?: number;         // 0..1 market phase risk
  avgConfidence?: number;     // 0..1 average confidence across horizons
}

export interface SizingInput {
  preset: PresetType;
  consensus: ConsensusResult;
  conflict: ConflictResult;
  risk: RiskFactors;
}

export interface SizingResult {
  mode: SizingMode;
  baseSize: number;
  consensusMultiplier: number;
  conflictMultiplier: number;
  riskMultiplier: number;
  finalSize: number;
  blockers: string[];
  explain: string[];
}

// ═══════════════════════════════════════════════════════════════
// PRESET CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════

export const PRESET_CONFIGS: Record<PresetType, PresetConfig> = {
  CONSERVATIVE: {
    type: 'CONSERVATIVE',
    baseSize: 0.20,
    maxSize: 0.35,
    minConfidence: 0.15,
    maxEntropy: 0.70,
    maxTailRisk: 0.45,
    minReliability: 0.60,
  },
  BALANCED: {
    type: 'BALANCED',
    baseSize: 0.35,
    maxSize: 0.60,
    minConfidence: 0.10,
    maxEntropy: 0.80,
    maxTailRisk: 0.55,
    minReliability: 0.50,
  },
  AGGRESSIVE: {
    type: 'AGGRESSIVE',
    baseSize: 0.55,
    maxSize: 0.85,
    minConfidence: 0.05,
    maxEntropy: 0.90,
    maxTailRisk: 0.65,
    minReliability: 0.40,
  },
};

// ═══════════════════════════════════════════════════════════════
// RISK MULTIPLIER CALCULATION
// ═══════════════════════════════════════════════════════════════

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Compute risk multiplier from various risk factors.
 * Returns value between 0.2 and 1.0
 */
function computeRiskMultiplier(
  risk: RiskFactors,
  preset: PresetConfig
): { multiplier: number; penalties: string[] } {
  const penalties: string[] = [];
  let multiplier = 1.0;

  const entropy = clamp(risk.entropy ?? 0.5, 0, 1);
  const tailRisk = clamp(risk.tailRisk ?? 0.3, 0, 1);
  const reliability = clamp(risk.reliability ?? 0.7, 0, 1);
  const phaseRisk = clamp(risk.phaseRisk ?? 0.3, 0, 1);

  // Entropy penalty (high uncertainty)
  if (entropy > 0.5) {
    const entropyPenalty = (entropy - 0.5) * 0.6; // up to 30% penalty
    multiplier *= (1 - entropyPenalty);
    if (entropyPenalty > 0.15) {
      penalties.push(`HIGH_ENTROPY: -${(entropyPenalty * 100).toFixed(0)}%`);
    }
  }

  // Tail risk penalty
  if (tailRisk > 0.35) {
    const tailPenalty = (tailRisk - 0.35) * 0.8; // up to ~50% penalty
    multiplier *= (1 - tailPenalty);
    if (tailPenalty > 0.15) {
      penalties.push(`HIGH_TAIL_RISK: -${(tailPenalty * 100).toFixed(0)}%`);
    }
  }

  // Reliability penalty (low reliability)
  if (reliability < preset.minReliability) {
    const relPenalty = (preset.minReliability - reliability) * 0.5;
    multiplier *= (1 - relPenalty);
    penalties.push(`LOW_RELIABILITY: -${(relPenalty * 100).toFixed(0)}%`);
  }

  // Phase risk penalty
  if (phaseRisk > 0.5) {
    const phasePenalty = (phaseRisk - 0.5) * 0.4;
    multiplier *= (1 - phasePenalty);
    if (phasePenalty > 0.1) {
      penalties.push(`PHASE_RISK: -${(phasePenalty * 100).toFixed(0)}%`);
    }
  }

  return {
    multiplier: clamp(multiplier, 0.2, 1.0),
    penalties,
  };
}

// ═══════════════════════════════════════════════════════════════
// BLOCKERS DETECTION
// ═══════════════════════════════════════════════════════════════

function detectBlockers(
  risk: RiskFactors,
  preset: PresetConfig,
  conflict: ConflictResult
): string[] {
  const blockers: string[] = [];

  const entropy = risk.entropy ?? 0.5;
  const tailRisk = risk.tailRisk ?? 0.3;
  const avgConfidence = risk.avgConfidence ?? 0.5;
  const reliability = risk.reliability ?? 0.7;

  // Hard blockers → NO_TRADE
  if (avgConfidence < preset.minConfidence) {
    blockers.push('LOW_CONFIDENCE');
  }
  if (entropy > preset.maxEntropy) {
    blockers.push('HIGH_ENTROPY');
  }
  if (tailRisk > preset.maxTailRisk) {
    blockers.push('HIGH_TAIL_RISK');
  }
  if (reliability < preset.minReliability * 0.7) {
    blockers.push('CRITICAL_RELIABILITY');
  }
  if (conflict.level === 'SEVERE') {
    blockers.push('SEVERE_CONFLICT');
  }
  if (conflict.mode === 'WAIT') {
    blockers.push('CONFLICT_WAIT');
  }

  return blockers;
}

// ═══════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════

export function computeSizingPolicy(input: SizingInput): SizingResult {
  const { preset: presetType, consensus, conflict, risk } = input;
  const preset = PRESET_CONFIGS[presetType];

  // Detect blockers first
  const blockers = detectBlockers(risk, preset, conflict);

  // If hard blockers → NO_TRADE
  if (blockers.length > 0) {
    return {
      mode: 'NO_TRADE',
      baseSize: preset.baseSize,
      consensusMultiplier: 0,
      conflictMultiplier: 0,
      riskMultiplier: 0,
      finalSize: 0,
      blockers,
      explain: [
        `Blocked: ${blockers.join(', ')}`,
        'Position sizing: 0% (no trade recommended)',
      ],
    };
  }

  // Calculate multipliers
  const consensusMultiplier = consensusToMultiplier(consensus.score);
  const conflictMultiplier = conflictToSizingMultiplier(conflict.level);
  const { multiplier: riskMultiplier, penalties } = computeRiskMultiplier(risk, preset);

  // Final size calculation
  let finalSize = preset.baseSize * consensusMultiplier * conflictMultiplier * riskMultiplier;

  // Cap at preset max
  finalSize = Math.min(finalSize, preset.maxSize);

  // Determine mode from conflict
  const mode: SizingMode = conflict.mode === 'WAIT' 
    ? 'NO_TRADE' 
    : conflict.mode === 'COUNTER_TREND' 
      ? 'COUNTER_TREND' 
      : 'TREND_FOLLOW';

  // Build explanation
  const explain: string[] = [
    `Preset: ${presetType} (base ${(preset.baseSize * 100).toFixed(0)}%)`,
    `Consensus: ${(consensus.score * 100).toFixed(0)}% → ×${consensusMultiplier.toFixed(2)}`,
    `Conflict: ${conflict.level} → ×${conflictMultiplier.toFixed(2)}`,
    `Risk: ×${riskMultiplier.toFixed(2)}`,
    ...penalties,
    `Final size: ${(finalSize * 100).toFixed(1)}% of capital`,
  ];

  if (mode === 'COUNTER_TREND') {
    explain.push('Mode: COUNTER_TREND — Trading against long-term bias (extra caution)');
  }

  return {
    mode,
    baseSize: preset.baseSize,
    consensusMultiplier,
    conflictMultiplier,
    riskMultiplier,
    finalSize,
    blockers: [],
    explain,
  };
}

// ═══════════════════════════════════════════════════════════════
// QUICK SIZING (for simple use cases)
// ═══════════════════════════════════════════════════════════════

/**
 * Quick sizing without full consensus/conflict computation.
 * Uses pre-computed scores.
 */
export function quickSizing(
  presetType: PresetType,
  consensusScore: number,
  conflictLevel: ConflictResult['level'],
  riskFactors: RiskFactors
): { size: number; mode: SizingMode; blockers: string[] } {
  const preset = PRESET_CONFIGS[presetType];
  
  // Simple blocker check
  const blockers: string[] = [];
  if ((riskFactors.entropy ?? 0) > preset.maxEntropy) blockers.push('HIGH_ENTROPY');
  if ((riskFactors.tailRisk ?? 0) > preset.maxTailRisk) blockers.push('HIGH_TAIL_RISK');
  if ((riskFactors.avgConfidence ?? 1) < preset.minConfidence) blockers.push('LOW_CONFIDENCE');

  if (blockers.length > 0 || conflictLevel === 'SEVERE') {
    return { size: 0, mode: 'NO_TRADE', blockers };
  }

  const consMult = consensusToMultiplier(consensusScore);
  const confMult = conflictToSizingMultiplier(conflictLevel);
  
  // Simple risk multiplier
  const entropy = riskFactors.entropy ?? 0.5;
  const tailRisk = riskFactors.tailRisk ?? 0.3;
  const riskMult = clamp(1 - (entropy * 0.3 + tailRisk * 0.4), 0.3, 1.0);

  const size = clamp(preset.baseSize * consMult * confMult * riskMult, 0, preset.maxSize);
  
  // Determine mode
  let mode: SizingMode = 'TREND_FOLLOW';
  if (conflictLevel === 'MAJOR' || conflictLevel === 'MODERATE') {
    mode = 'COUNTER_TREND';
  }

  return { size, mode, blockers };
}

// ═══════════════════════════════════════════════════════════════
// SIZE TO LABEL (for UI)
// ═══════════════════════════════════════════════════════════════

export type SizeLabel = 'NONE' | 'MINIMAL' | 'SMALL' | 'MEDIUM' | 'LARGE' | 'FULL';

export function sizeToLabel(size: number): SizeLabel {
  if (size <= 0) return 'NONE';
  if (size < 0.10) return 'MINIMAL';
  if (size < 0.25) return 'SMALL';
  if (size < 0.45) return 'MEDIUM';
  if (size < 0.70) return 'LARGE';
  return 'FULL';
}

export function sizeLabelToColor(label: SizeLabel): string {
  const colors: Record<SizeLabel, string> = {
    NONE: '#6b7280',     // gray
    MINIMAL: '#f59e0b',  // amber
    SMALL: '#84cc16',    // lime
    MEDIUM: '#22c55e',   // green
    LARGE: '#3b82f6',    // blue
    FULL: '#8b5cf6',     // violet
  };
  return colors[label];
}
