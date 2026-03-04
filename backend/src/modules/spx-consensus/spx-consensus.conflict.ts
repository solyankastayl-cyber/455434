/**
 * SPX CONSENSUS ENGINE — Conflict Detection
 * 
 * BLOCK B5.5 — Detect tier conflicts and structural lock
 * 
 * Rules:
 * - S1: Structural Lock if STRUCTURE weight ≥ 55%
 * - S2: Conflict levels based on tier agreement
 * - S3: CRITICAL if split within STRUCTURE tier
 */

import type { 
  HorizonVote, 
  Tier, 
  Direction, 
  ConflictLevel, 
  ConflictResult 
} from './spx-consensus.types.js';

// ═══════════════════════════════════════════════════════════════
// CONFLICT DETECTION
// ═══════════════════════════════════════════════════════════════

export function detectConflict(votes: HorizonVote[]): ConflictResult {
  // Group votes by tier
  const byTier: Record<Tier, HorizonVote[]> = {
    TIMING: [],
    TACTICAL: [],
    STRUCTURE: [],
  };
  
  for (const v of votes) {
    byTier[v.tier].push(v);
  }
  
  // Get dominant direction per tier (weighted by voteScore)
  const tierDirections: Record<Tier, Direction | 'SPLIT'> = {
    TIMING: getTierDirection(byTier.TIMING),
    TACTICAL: getTierDirection(byTier.TACTICAL),
    STRUCTURE: getTierDirection(byTier.STRUCTURE),
  };
  
  // Calculate tier weights
  const tierWeights: Record<Tier, number> = {
    TIMING: byTier.TIMING.reduce((s, v) => s + v.weight, 0),
    TACTICAL: byTier.TACTICAL.reduce((s, v) => s + v.weight, 0),
    STRUCTURE: byTier.STRUCTURE.reduce((s, v) => s + v.weight, 0),
  };
  
  const totalWeight = tierWeights.TIMING + tierWeights.TACTICAL + tierWeights.STRUCTURE;
  const structurePct = totalWeight > 0 ? tierWeights.STRUCTURE / totalWeight : 0;
  
  // Rule S1: Structural Lock
  const structuralLock = structurePct >= 0.55;
  
  // Determine dominance
  let dominance: Tier = 'STRUCTURE';
  if (tierWeights.TACTICAL > tierWeights.STRUCTURE && tierWeights.TACTICAL > tierWeights.TIMING) {
    dominance = 'TACTICAL';
  } else if (tierWeights.TIMING > tierWeights.STRUCTURE && tierWeights.TIMING > tierWeights.TACTICAL) {
    dominance = 'TIMING';
  }
  
  // Determine conflict level
  let level: ConflictLevel = 'LOW';
  let description = 'All tiers aligned';
  
  const structDir = tierDirections.STRUCTURE;
  const tactDir = tierDirections.TACTICAL;
  const timingDir = tierDirections.TIMING;
  
  // Rule S3: CRITICAL if split within STRUCTURE
  if (structDir === 'SPLIT') {
    level = 'CRITICAL';
    description = 'Structure tier split (180d vs 365d disagree)';
  }
  // Rule S2: HIGH if structure against both
  else if (structDir !== 'NEUTRAL' && structDir !== tactDir && structDir !== timingDir && tactDir !== 'NEUTRAL') {
    level = 'HIGH';
    description = 'Structure vs both Tactical and Timing';
  }
  // MODERATE: timing against structure but tactical agrees with structure
  else if (structDir !== 'NEUTRAL' && timingDir !== 'NEUTRAL' && structDir !== timingDir && structDir === tactDir) {
    level = 'MODERATE';
    description = 'Timing against Structure (Tactical aligned)';
  }
  // LOW: all agree or neutral
  else if (allSameDirection(structDir, tactDir, timingDir)) {
    level = 'LOW';
    description = 'All tiers aligned';
  }
  
  return {
    level,
    dominance,
    structuralLock,
    description,
    tierDirections,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getTierDirection(votes: HorizonVote[]): Direction | 'SPLIT' {
  if (votes.length === 0) return 'NEUTRAL';
  
  // Check for split within tier
  const directions = new Set(votes.map(v => v.direction));
  if (directions.has('BULL') && directions.has('BEAR')) {
    return 'SPLIT';
  }
  
  // Weighted direction
  let bullScore = 0;
  let bearScore = 0;
  
  for (const v of votes) {
    if (v.direction === 'BULL') {
      bullScore += Math.abs(v.voteScore);
    } else if (v.direction === 'BEAR') {
      bearScore += Math.abs(v.voteScore);
    }
  }
  
  if (bullScore > bearScore * 1.1) return 'BULL';
  if (bearScore > bullScore * 1.1) return 'BEAR';
  return 'NEUTRAL';
}

function allSameDirection(a: Direction | 'SPLIT', b: Direction | 'SPLIT', c: Direction | 'SPLIT'): boolean {
  const nonNeutral = [a, b, c].filter(d => d !== 'NEUTRAL' && d !== 'SPLIT');
  if (nonNeutral.length <= 1) return true;
  return nonNeutral.every(d => d === nonNeutral[0]);
}

export default detectConflict;
