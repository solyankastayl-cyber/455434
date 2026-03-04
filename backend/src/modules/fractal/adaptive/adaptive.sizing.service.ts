/**
 * BLOCK 64 — Adaptive Sizing Stack
 * 
 * Full breakdown of position size:
 * finalSize = base × tierWeight × consensus × conflict × volatility × tail × governance
 * 
 * Everything is transparent and explainable.
 */

import type { RegimeContext } from '../regime/regime.types.js';
import type { ConsensusResult } from '../strategy/resolver/consensus.index.js';
import type { AdaptiveConflictResult } from './adaptive.conflict.service.js';
import type { TierWeights } from './adaptive.types.js';
import type { VolatilityResult } from '../volatility/volatility.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type PresetType = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type SizingMode = 'TREND_FOLLOW' | 'COUNTER_TREND' | 'NO_TRADE';

export interface SizingBreakdown {
  baseSize: number;           // From preset
  tierWeightMod: number;      // From adaptive horizon weights
  consensusMod: number;       // From consensus score
  conflictMod: number;        // From conflict resolution
  volatilityMod: number;      // From volatility regime
  tailRiskMod: number;        // From tail risk metrics
  reliabilityMod: number;     // From reliability health
  governanceMod: number;      // From governance overrides
  phaseMod: number;           // BLOCK 73.7: From phase grade
  finalSize: number;          // Product of all
  sizeBeforeVol: number;      // Size before volatility clamp (for attribution)
}

export interface AdaptiveSizingResult {
  mode: SizingMode;
  preset: PresetType;
  breakdown: SizingBreakdown;
  blockers: string[];
  explain: string[];
}

export interface AdaptiveSizingInput {
  preset: PresetType;
  context: RegimeContext;
  consensus: ConsensusResult;
  conflict: AdaptiveConflictResult;
  tierWeights: TierWeights;
  volatility: VolatilityResult;
  thresholdBlockers: string[];
  // BLOCK 73.7: Phase performance grade
  phaseGrade?: 'A' | 'B' | 'C' | 'D' | 'F';
  phaseSampleQuality?: 'OK' | 'LOW_SAMPLE' | 'VERY_LOW_SAMPLE';
}

// ═══════════════════════════════════════════════════════════════
// PRESET BASE SIZES
// ═══════════════════════════════════════════════════════════════

const PRESET_BASE_SIZE: Record<PresetType, number> = {
  CONSERVATIVE: 0.20,
  BALANCED: 0.35,
  AGGRESSIVE: 0.55,
};

const PRESET_MAX_SIZE: Record<PresetType, number> = {
  CONSERVATIVE: 0.35,
  BALANCED: 0.60,
  AGGRESSIVE: 0.85,
};

// ═══════════════════════════════════════════════════════════════
// BLOCK 73.7: PHASE GRADE MULTIPLIERS
// Boost only if sampleQuality = OK
// ═══════════════════════════════════════════════════════════════

const PHASE_GRADE_MULTIPLIER: Record<string, number> = {
  'A': 1.15,  // Strong phase → boost
  'B': 1.05,  // Good phase → slight boost
  'C': 1.00,  // Neutral
  'D': 0.80,  // Weak phase → reduce
  'F': 0.60,  // Very weak → significant reduction
};

// If sample quality not OK, cap multiplier to prevent boost on uncertain data
const PHASE_LOW_SAMPLE_CAP = 1.00;   // No boost for LOW_SAMPLE
const PHASE_VERY_LOW_CAP = 0.90;     // Slight penalty for VERY_LOW_SAMPLE

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export class AdaptiveSizingService {
  /**
   * Compute adaptive sizing with full breakdown.
   */
  computeSizing(input: AdaptiveSizingInput): AdaptiveSizingResult {
    const {
      preset,
      context,
      consensus,
      conflict,
      tierWeights,
      volatility,
      thresholdBlockers,
      phaseGrade,
      phaseSampleQuality,
    } = input;

    const blockers: string[] = [...thresholdBlockers];
    const explain: string[] = [];

    // Check for hard blockers
    if (conflict.effectiveMode === 'HOLD' || conflict.effectiveMode === 'WAIT') {
      blockers.push(`CONFLICT_${conflict.effectiveMode}`);
    }
    if (context.flags.noNewTrades) {
      blockers.push('NO_NEW_TRADES');
    }
    if (volatility.blockers.length > 0) {
      blockers.push(...volatility.blockers);
    }

    // If blockers → NO_TRADE
    if (blockers.length > 0) {
      return {
        mode: 'NO_TRADE',
        preset,
        breakdown: this.zeroBreakdown(preset),
        blockers,
        explain: [`Blocked: ${blockers.join(', ')}`],
      };
    }

    // Calculate all modifiers
    const baseSize = PRESET_BASE_SIZE[preset];
    const maxSize = PRESET_MAX_SIZE[preset];

    // Tier weight modifier (how much structure is weighted)
    // If structure dominates, slightly boost overall confidence in sizing
    const tierWeightMod = this.computeTierWeightModifier(tierWeights, context);

    // Consensus modifier (0.2 - 1.0)
    const consensusMod = this.consensusToModifier(consensus.score);

    // Conflict modifier (1.0 - sizePenalty)
    const conflictMod = Math.max(0.1, 1 - conflict.sizePenalty);

    // Volatility modifier (from volatility service)
    const volatilityMod = volatility.policy.sizeMultiplier;

    // Tail risk modifier
    const tailRiskMod = this.computeTailRiskModifier(context.tailRisk);

    // Reliability modifier
    const reliabilityMod = this.computeReliabilityModifier(context.reliability);

    // Governance modifier (usually 1.0 unless frozen)
    const governanceMod = context.flags.frozenOnly ? 0.5 : 1.0;

    // ═══════════════════════════════════════════════════════════════
    // BLOCK 73.7: Phase Grade Modifier
    // Only apply boost if sampleQuality = OK
    // ═══════════════════════════════════════════════════════════════
    const phaseMod = this.computePhaseModifier(phaseGrade, phaseSampleQuality);

    // Calculate size before volatility (for attribution)
    const sizeBeforeVol = 
      baseSize * 
      tierWeightMod * 
      consensusMod * 
      conflictMod * 
      tailRiskMod * 
      reliabilityMod * 
      governanceMod *
      phaseMod;  // BLOCK 73.7

    // Final size with volatility clamp
    let finalSize = sizeBeforeVol * volatilityMod;
    finalSize = Math.min(finalSize, maxSize);
    finalSize = Math.max(0, finalSize);

    // Determine mode
    let mode: SizingMode = 'TREND_FOLLOW';
    if (conflict.effectiveMode === 'COUNTER_TREND') {
      mode = 'COUNTER_TREND';
    }

    // Build explain
    explain.push(`Base (${preset}): ${(baseSize * 100).toFixed(0)}%`);
    explain.push(`× Tier weight: ${tierWeightMod.toFixed(2)}`);
    explain.push(`× Consensus (${(consensus.score * 100).toFixed(0)}%): ${consensusMod.toFixed(2)}`);
    explain.push(`× Conflict (${conflict.effectiveMode}): ${conflictMod.toFixed(2)}`);
    explain.push(`× Volatility (${context.volRegime}): ${volatilityMod.toFixed(2)}`);
    if (tailRiskMod < 1) explain.push(`× Tail risk: ${tailRiskMod.toFixed(2)}`);
    if (reliabilityMod < 1) explain.push(`× Reliability: ${reliabilityMod.toFixed(2)}`);
    if (governanceMod < 1) explain.push(`× Governance: ${governanceMod.toFixed(2)}`);
    if (phaseMod !== 1) explain.push(`× Phase (${phaseGrade || 'N/A'}): ${phaseMod.toFixed(2)}`);
    explain.push(`= Final: ${(finalSize * 100).toFixed(1)}%`);

    return {
      mode,
      preset,
      breakdown: {
        baseSize,
        tierWeightMod,
        consensusMod,
        conflictMod,
        volatilityMod,
        tailRiskMod,
        reliabilityMod,
        governanceMod,
        phaseMod,  // BLOCK 73.7
        sizeBeforeVol,
        finalSize,
      },
      blockers: [],
      explain,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 73.7: PHASE MODIFIER COMPUTATION
  // ═══════════════════════════════════════════════════════════════

  private computePhaseModifier(
    phaseGrade?: 'A' | 'B' | 'C' | 'D' | 'F',
    phaseSampleQuality?: 'OK' | 'LOW_SAMPLE' | 'VERY_LOW_SAMPLE'
  ): number {
    // No phase data → neutral modifier
    if (!phaseGrade) return 1.0;
    
    // Get base multiplier from grade
    let multiplier = PHASE_GRADE_MULTIPLIER[phaseGrade] ?? 1.0;
    
    // Apply sample quality caps (prevent boost on uncertain data)
    if (phaseSampleQuality === 'LOW_SAMPLE') {
      // Cap at 1.0 - no boost for low samples, but allow penalties
      multiplier = Math.min(multiplier, PHASE_LOW_SAMPLE_CAP);
    } else if (phaseSampleQuality === 'VERY_LOW_SAMPLE') {
      // Cap at 0.90 - slight penalty for very low samples
      multiplier = Math.min(multiplier, PHASE_VERY_LOW_CAP);
    }
    
    return multiplier;
  }

  // ═══════════════════════════════════════════════════════════════
  // MODIFIERS
  // ═══════════════════════════════════════════════════════════════

  private computeTierWeightModifier(weights: TierWeights, context: RegimeContext): number {
    // If structure heavily weighted (>0.6), slight boost to conviction
    // If timing weighted (structure < 0.4), slight penalty
    if (context.flags.structureDominates) {
      return 1.05; // Slight boost when structure dominates
    }
    if (weights.STRUCTURE > 0.6) {
      return 1.02;
    }
    if (weights.STRUCTURE < 0.4) {
      return 0.95;
    }
    return 1.0;
  }

  private consensusToModifier(score: number): number {
    // Smooth mapping from consensus score to size modifier
    // score 0 → 0.2, score 0.5 → 0.6, score 1 → 1.0
    if (score <= 0.25) return 0.2 + score * 0.8;
    if (score <= 0.55) return 0.4 + (score - 0.25) * 0.67;
    if (score <= 0.80) return 0.6 + (score - 0.55) * 0.8;
    return 0.8 + (score - 0.8) * 1.0;
  }

  private computeTailRiskModifier(tailRisk: RegimeContext['tailRisk']): number {
    // Higher tail risk → lower modifier
    const mcP95 = tailRisk.mcP95;
    if (mcP95 < 0.25) return 1.0;
    if (mcP95 < 0.35) return 0.95;
    if (mcP95 < 0.45) return 0.85;
    if (mcP95 < 0.55) return 0.70;
    return 0.50;
  }

  private computeReliabilityModifier(reliability: RegimeContext['reliability']): number {
    switch (reliability.badge) {
      case 'OK': return 1.0;
      case 'WARN': return 0.85;
      case 'CRITICAL': return 0.60;
      case 'HALT': return 0;
    }
  }

  private zeroBreakdown(preset: PresetType): SizingBreakdown {
    return {
      baseSize: PRESET_BASE_SIZE[preset],
      tierWeightMod: 0,
      consensusMod: 0,
      conflictMod: 0,
      volatilityMod: 0,
      tailRiskMod: 0,
      reliabilityMod: 0,
      governanceMod: 0,
      phaseMod: 1.0,  // BLOCK 73.7: neutral for blocked trades
      sizeBeforeVol: 0,
      finalSize: 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _instance: AdaptiveSizingService | null = null;

export function getAdaptiveSizingService(): AdaptiveSizingService {
  if (!_instance) {
    _instance = new AdaptiveSizingService();
  }
  return _instance;
}
