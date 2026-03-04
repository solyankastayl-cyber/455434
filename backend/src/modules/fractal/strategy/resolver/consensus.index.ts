/**
 * BLOCK 59.2 — P1.1: Consensus Index
 * 
 * Calculates weighted agreement across horizons.
 * Not just visual — affects sizing.
 * 
 * Tier weights (fund-grade):
 * - TIMING (7d/14d): 0.25
 * - TACTICAL (30d/90d): 0.35
 * - STRUCTURE (180d/365d): 0.40
 * 
 * Penalties reduce vote weight:
 * - LOW_CONFIDENCE: -0.35
 * - HIGH_ENTROPY: -0.25
 * - HIGH_TAIL_RISK: -0.30
 * - DEGRADED_RELIABILITY: -0.40
 */

import type { HorizonKey } from '../../config/horizon.config.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type Direction = 'BUY' | 'SELL' | 'HOLD';
export type Tier = 'TIMING' | 'TACTICAL' | 'STRUCTURE';

export interface HorizonVote {
  horizon: HorizonKey;
  tier: Tier;
  direction: Direction;
  rawConfidence: number;
  tierWeight: number;
  penalties: string[];
  penaltyTotal: number;
  effectiveWeight: number;
  contribution: number; // signed: positive for BUY, negative for SELL
}

export interface ConsensusResult {
  score: number;           // 0..1 (how strong the agreement is)
  dir: Direction;          // dominant direction
  dispersion: number;      // 1 - score (disagreement level)
  buyWeight: number;
  sellWeight: number;
  holdWeight: number;
  votes: HorizonVote[];
}

export interface HorizonSignalInput {
  horizon: HorizonKey;
  direction: Direction;
  confidence: number;      // 0..1
  blockers?: string[];
  reliability?: number;    // 0..1
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS (Fund-grade)
// ═══════════════════════════════════════════════════════════════

// Tier weights sum to 1.0
const TIER_WEIGHTS: Record<Tier, number> = {
  TIMING: 0.25,     // 7d, 14d
  TACTICAL: 0.35,   // 30d, 90d
  STRUCTURE: 0.40,  // 180d, 365d
};

// How many horizons in each tier
const TIER_HORIZON_COUNT: Record<Tier, number> = {
  TIMING: 2,     // 7d, 14d
  TACTICAL: 2,   // 30d, 90d
  STRUCTURE: 2,  // 180d, 365d
};

// Blocker penalties (reduce vote weight)
const BLOCKER_PENALTIES: Record<string, number> = {
  'LOW_CONFIDENCE': 0.35,
  'HIGH_ENTROPY': 0.25,
  'HIGH_TAIL_RISK': 0.30,
  'DEGRADED_RELIABILITY': 0.40,
  'LOW_SAMPLE': 0.20,
  'INSUFFICIENT_DATA': 0.50,
  'COMPUTATION_ERROR': 0.60,
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getTier(horizon: HorizonKey): Tier {
  if (['7d', '14d'].includes(horizon)) return 'TIMING';
  if (['30d', '90d'].includes(horizon)) return 'TACTICAL';
  return 'STRUCTURE';
}

function computePenalty(blockers: string[]): { total: number; applied: string[] } {
  const applied: string[] = [];
  let total = 0;

  for (const b of blockers) {
    const penalty = BLOCKER_PENALTIES[b];
    if (penalty) {
      total += penalty;
      applied.push(b);
    }
  }

  // Cap at 1.0 (can't go below zero weight)
  return { total: Math.min(1, total), applied };
}

function directionSign(dir: Direction): number {
  if (dir === 'BUY') return 1;
  if (dir === 'SELL') return -1;
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════

export function computeConsensusIndex(signals: HorizonSignalInput[]): ConsensusResult {
  const votes: HorizonVote[] = [];

  let buyWeight = 0;
  let sellWeight = 0;
  let holdWeight = 0;

  for (const sig of signals) {
    const tier = getTier(sig.horizon);
    const tierWeight = TIER_WEIGHTS[tier] / TIER_HORIZON_COUNT[tier];
    const { total: penaltyTotal, applied: penalties } = computePenalty(sig.blockers || []);

    // Effective weight = tier weight × confidence × (1 - penalty)
    const conf = Math.max(0, Math.min(1, sig.confidence || 0));
    const reliabilityMod = Math.max(0.5, Math.min(1, sig.reliability || 0.75));
    const effectiveWeight = tierWeight * conf * reliabilityMod * (1 - penaltyTotal);

    const sign = directionSign(sig.direction);
    const contribution = sign * effectiveWeight;

    votes.push({
      horizon: sig.horizon,
      tier,
      direction: sig.direction,
      rawConfidence: conf,
      tierWeight,
      penalties,
      penaltyTotal,
      effectiveWeight,
      contribution,
    });

    // Accumulate by direction
    if (sig.direction === 'BUY') buyWeight += effectiveWeight;
    else if (sig.direction === 'SELL') sellWeight += effectiveWeight;
    else holdWeight += effectiveWeight;
  }

  const totalWeight = buyWeight + sellWeight + holdWeight + 1e-9;
  const maxWeight = Math.max(buyWeight, sellWeight, holdWeight);

  // Score = how dominant the leading direction is
  const score = maxWeight / totalWeight;
  const dispersion = 1 - score;

  // Determine dominant direction
  let dir: Direction = 'HOLD';
  if (buyWeight >= sellWeight && buyWeight >= holdWeight) dir = 'BUY';
  else if (sellWeight >= buyWeight && sellWeight >= holdWeight) dir = 'SELL';

  return {
    score,
    dir,
    dispersion,
    buyWeight,
    sellWeight,
    holdWeight,
    votes,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONSENSUS MULTIPLIER (for sizing)
// ═══════════════════════════════════════════════════════════════

/**
 * Convert consensus score to sizing multiplier.
 * Uses smoothstep for gradual transition.
 * 
 * Low consensus (0.2-0.3) → mult ~0.2
 * Medium consensus (0.5) → mult ~0.5
 * High consensus (0.8+) → mult ~1.0
 */
export function consensusToMultiplier(score: number): number {
  // Smoothstep function
  const low = 0.25;
  const high = 0.80;
  
  const t = Math.max(0, Math.min(1, (score - low) / (high - low)));
  const smooth = t * t * (3 - 2 * t); // smoothstep
  
  // Map to [0.2, 1.0] range
  return 0.2 + smooth * 0.8;
}
