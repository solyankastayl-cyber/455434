/**
 * BLOCK 59.2 — P1.2: Conflict Resolver Policy
 * 
 * Classifies conflicts between long-term bias (Structure: 180d/365d)
 * and short-term timing signals (Timing: 7d/14d/30d).
 * 
 * Conflict Levels:
 * - NONE: Full agreement across all tiers
 * - MINOR: Tactical disagrees, but Structure and Timing align
 * - MODERATE: Structure and Timing have weak disagreement
 * - MAJOR: Structure and Timing strongly oppose each other
 * - SEVERE: All tiers disagree + high entropy
 * 
 * Resolution Modes:
 * - TREND_FOLLOW: Go with the dominant trend (Structure wins)
 * - COUNTER_TREND: Short-term reversal against Structure
 * - WAIT: Conflict too severe, no action recommended
 * 
 * Sizing Penalty:
 * - NONE: 0%
 * - MINOR: 10%
 * - MODERATE: 25%
 * - MAJOR: 50%
 * - SEVERE: 75%+
 */

import type { HorizonKey } from '../../config/horizon.config.js';
import type { ConsensusResult, Direction, Tier } from './consensus.index.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type ConflictLevel = 'NONE' | 'MINOR' | 'MODERATE' | 'MAJOR' | 'SEVERE';
export type ResolutionMode = 'TREND_FOLLOW' | 'COUNTER_TREND' | 'WAIT';

export interface TierSummary {
  tier: Tier;
  dominantDir: Direction;
  strength: number;      // 0..1 how strong the dominant direction is
  horizons: HorizonKey[];
  agreement: number;     // 0..1 internal agreement within tier
}

export interface ConflictResult {
  level: ConflictLevel;
  mode: ResolutionMode;
  sizingPenalty: number;  // 0..1 penalty to apply to position size
  
  // Tier breakdown
  structure: TierSummary;
  tactical: TierSummary;
  timing: TierSummary;
  
  // Conflict details
  structureVsTiming: {
    aligned: boolean;
    structureDir: Direction;
    timingDir: Direction;
    divergenceScore: number;  // 0..1 how much they diverge
  };
  
  // Explanation for UI
  explain: string[];
  recommendation: string;
}

export interface ConflictInput {
  consensus: ConsensusResult;
  globalEntropy?: number;
  mcP95_DD?: number;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const TIER_HORIZONS: Record<Tier, HorizonKey[]> = {
  TIMING: ['7d', '14d'],
  TACTICAL: ['30d', '90d'],
  STRUCTURE: ['180d', '365d'],
};

const CONFLICT_PENALTIES: Record<ConflictLevel, number> = {
  NONE: 0,
  MINOR: 0.10,
  MODERATE: 0.25,
  MAJOR: 0.50,
  SEVERE: 0.75,
};

// Thresholds for conflict classification
const THRESHOLDS = {
  // Minimum strength to consider a tier "active"
  MIN_TIER_STRENGTH: 0.15,
  // Divergence score above which conflict is MAJOR
  MAJOR_DIVERGENCE: 0.6,
  // Divergence score above which conflict is MODERATE
  MODERATE_DIVERGENCE: 0.3,
  // Entropy above which we escalate conflict level
  HIGH_ENTROPY: 0.7,
  // Tail risk above which we escalate conflict level
  HIGH_TAIL_RISK: 0.5,
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function computeTierSummary(
  consensus: ConsensusResult,
  tier: Tier
): TierSummary {
  const horizons = TIER_HORIZONS[tier];
  const votes = consensus.votes.filter(v => horizons.includes(v.horizon));
  
  if (votes.length === 0) {
    return {
      tier,
      dominantDir: 'HOLD',
      strength: 0,
      horizons,
      agreement: 0,
    };
  }

  // Calculate weighted direction
  let buyWeight = 0;
  let sellWeight = 0;
  let holdWeight = 0;

  for (const v of votes) {
    if (v.direction === 'BUY') buyWeight += v.effectiveWeight;
    else if (v.direction === 'SELL') sellWeight += v.effectiveWeight;
    else holdWeight += v.effectiveWeight;
  }

  const totalWeight = buyWeight + sellWeight + holdWeight + 1e-9;
  const maxWeight = Math.max(buyWeight, sellWeight, holdWeight);

  // Dominant direction
  let dominantDir: Direction = 'HOLD';
  if (buyWeight >= sellWeight && buyWeight >= holdWeight) dominantDir = 'BUY';
  else if (sellWeight >= buyWeight && sellWeight >= holdWeight) dominantDir = 'SELL';

  // Strength = how dominant the leading direction is
  const strength = maxWeight / totalWeight;

  // Agreement = how much votes within tier agree
  // 1.0 = all same direction, 0.5 = split, 0.0 = impossible
  const agreement = strength;

  return {
    tier,
    dominantDir,
    strength,
    horizons,
    agreement,
  };
}

function computeDivergence(dir1: Direction, str1: number, dir2: Direction, str2: number): number {
  // Same direction = no divergence
  if (dir1 === dir2) return 0;
  
  // One is HOLD = partial divergence based on the other's strength
  if (dir1 === 'HOLD' || dir2 === 'HOLD') {
    return Math.max(str1, str2) * 0.5;
  }

  // Opposite directions (BUY vs SELL) = full divergence weighted by strengths
  return (str1 + str2) / 2;
}

function classifyConflictLevel(
  structureVsTiming: number,
  internalDisagreement: number,
  entropy: number,
  tailRisk: number
): ConflictLevel {
  // Escalation factors
  const entropyEscalation = entropy > THRESHOLDS.HIGH_ENTROPY ? 1 : 0;
  const tailEscalation = tailRisk > THRESHOLDS.HIGH_TAIL_RISK ? 1 : 0;
  const escalations = entropyEscalation + tailEscalation;

  // Base classification from structure vs timing divergence
  let baseLevel: ConflictLevel = 'NONE';
  
  if (structureVsTiming >= THRESHOLDS.MAJOR_DIVERGENCE) {
    baseLevel = 'MAJOR';
  } else if (structureVsTiming >= THRESHOLDS.MODERATE_DIVERGENCE) {
    baseLevel = 'MODERATE';
  } else if (internalDisagreement > 0.3) {
    baseLevel = 'MINOR';
  }

  // Escalate based on entropy/tail risk
  const levels: ConflictLevel[] = ['NONE', 'MINOR', 'MODERATE', 'MAJOR', 'SEVERE'];
  const baseIdx = levels.indexOf(baseLevel);
  const escalatedIdx = Math.min(baseIdx + escalations, levels.length - 1);

  return levels[escalatedIdx];
}

function determineResolutionMode(
  structure: TierSummary,
  timing: TierSummary,
  conflictLevel: ConflictLevel
): ResolutionMode {
  // SEVERE conflict = WAIT
  if (conflictLevel === 'SEVERE') {
    return 'WAIT';
  }

  // If structure is weak, follow timing
  if (structure.strength < THRESHOLDS.MIN_TIER_STRENGTH) {
    return timing.dominantDir !== 'HOLD' ? 'TREND_FOLLOW' : 'WAIT';
  }

  // If timing is weak, follow structure
  if (timing.strength < THRESHOLDS.MIN_TIER_STRENGTH) {
    return structure.dominantDir !== 'HOLD' ? 'TREND_FOLLOW' : 'WAIT';
  }

  // Both have signal
  const aligned = structure.dominantDir === timing.dominantDir;
  
  if (aligned) {
    return 'TREND_FOLLOW';
  }

  // Timing opposes structure
  // If structure is much stronger, this is counter-trend (risky)
  if (structure.strength > timing.strength * 1.5) {
    // Counter-trend only if timing is confident
    if (timing.strength > 0.4) {
      return 'COUNTER_TREND';
    }
    return 'WAIT';
  }

  // Timing is strong enough to potentially override
  // But this is still counter-trend
  return 'COUNTER_TREND';
}

function generateExplanation(
  structure: TierSummary,
  tactical: TierSummary,
  timing: TierSummary,
  conflictLevel: ConflictLevel,
  mode: ResolutionMode
): string[] {
  const explain: string[] = [];

  // Structure summary
  if (structure.strength > THRESHOLDS.MIN_TIER_STRENGTH) {
    explain.push(`Structure (180d/365d): ${structure.dominantDir} (strength ${(structure.strength * 100).toFixed(0)}%)`);
  } else {
    explain.push('Structure (180d/365d): No clear signal');
  }

  // Tactical summary
  if (tactical.strength > THRESHOLDS.MIN_TIER_STRENGTH) {
    explain.push(`Tactical (30d/90d): ${tactical.dominantDir} (strength ${(tactical.strength * 100).toFixed(0)}%)`);
  }

  // Timing summary
  if (timing.strength > THRESHOLDS.MIN_TIER_STRENGTH) {
    explain.push(`Timing (7d/14d): ${timing.dominantDir} (strength ${(timing.strength * 100).toFixed(0)}%)`);
  } else {
    explain.push('Timing (7d/14d): No clear entry signal');
  }

  // Conflict explanation
  if (conflictLevel !== 'NONE') {
    explain.push(`Conflict: ${conflictLevel} — Structure and Timing disagree`);
  }

  // Mode explanation
  switch (mode) {
    case 'TREND_FOLLOW':
      explain.push('Mode: TREND_FOLLOW — Following dominant market direction');
      break;
    case 'COUNTER_TREND':
      explain.push('Mode: COUNTER_TREND — Short-term reversal against long-term trend (reduced size)');
      break;
    case 'WAIT':
      explain.push('Mode: WAIT — Conflict too severe, recommend no action');
      break;
  }

  return explain;
}

function generateRecommendation(
  mode: ResolutionMode,
  conflictLevel: ConflictLevel,
  structure: TierSummary,
  timing: TierSummary
): string {
  if (mode === 'WAIT') {
    return 'No action recommended due to conflicting signals. Wait for clearer market structure.';
  }

  if (mode === 'COUNTER_TREND') {
    return `Counter-trend entry ${timing.dominantDir} against ${structure.dominantDir} structure. Use reduced position size (${((1 - CONFLICT_PENALTIES[conflictLevel]) * 100).toFixed(0)}% of normal).`;
  }

  if (conflictLevel === 'NONE') {
    return `Full agreement across horizons. ${timing.dominantDir} with full conviction.`;
  }

  return `Trend-following ${structure.dominantDir} with ${conflictLevel.toLowerCase()} conflict adjustment.`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════

export function computeConflictPolicy(input: ConflictInput): ConflictResult {
  const { consensus, globalEntropy = 0, mcP95_DD = 0 } = input;

  // Compute tier summaries
  const structure = computeTierSummary(consensus, 'STRUCTURE');
  const tactical = computeTierSummary(consensus, 'TACTICAL');
  const timing = computeTierSummary(consensus, 'TIMING');

  // Compute divergence between Structure and Timing
  const structureVsTimingDivergence = computeDivergence(
    structure.dominantDir,
    structure.strength,
    timing.dominantDir,
    timing.strength
  );

  // Internal disagreement (weighted average of tier disagreements)
  const internalDisagreement = (
    (1 - structure.agreement) * 0.4 +
    (1 - tactical.agreement) * 0.35 +
    (1 - timing.agreement) * 0.25
  );

  // Classify conflict level
  const level = classifyConflictLevel(
    structureVsTimingDivergence,
    internalDisagreement,
    globalEntropy,
    mcP95_DD
  );

  // Determine resolution mode
  const mode = determineResolutionMode(structure, timing, level);

  // Get sizing penalty
  const sizingPenalty = CONFLICT_PENALTIES[level];

  // Determine if aligned
  const aligned = structure.dominantDir === timing.dominantDir ||
                  structure.dominantDir === 'HOLD' ||
                  timing.dominantDir === 'HOLD';

  // Generate explanations
  const explain = generateExplanation(structure, tactical, timing, level, mode);
  const recommendation = generateRecommendation(mode, level, structure, timing);

  return {
    level,
    mode,
    sizingPenalty,
    structure,
    tactical,
    timing,
    structureVsTiming: {
      aligned,
      structureDir: structure.dominantDir,
      timingDir: timing.dominantDir,
      divergenceScore: structureVsTimingDivergence,
    },
    explain,
    recommendation,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONFLICT PENALTY FOR SIZING
// ═══════════════════════════════════════════════════════════════

/**
 * Get the sizing multiplier based on conflict level.
 * Returns value between 0.25 and 1.0
 */
export function conflictToSizingMultiplier(level: ConflictLevel): number {
  return 1 - CONFLICT_PENALTIES[level];
}

/**
 * Check if action should be blocked due to conflict
 */
export function shouldBlockAction(result: ConflictResult): boolean {
  return result.mode === 'WAIT' || result.level === 'SEVERE';
}
