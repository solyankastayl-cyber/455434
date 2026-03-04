/**
 * B2 — Universe Score Calculators
 * 
 * LOCKED v1 formulas for:
 * - liquidityScore
 * - derivativesScore
 * - whaleScore
 * - universeScore
 */

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function safeLog10(x: number): number {
  if (x <= 0) return 0;
  return Math.log10(x);
}

// ═══════════════════════════════════════════════════════════════
// LIQUIDITY SCORE
// Formula: log10(volume24h / 1M) / 2, clamped to [0, 1]
// $10M → ~0.5, $100M → ~1.0
// ═══════════════════════════════════════════════════════════════

export interface LiquidityScoreInput {
  volume24hUsd: number;
  depthUsd?: number; // Optional order book depth
}

export function computeLiquidityScore(input: LiquidityScoreInput): {
  score: number;
  components: { volumeNorm: number; depthNorm: number };
} {
  const volumeNorm = clamp01(safeLog10(input.volume24hUsd / 1_000_000) / 2);
  
  // If depth available, use it; otherwise just use volume
  let depthNorm = 1.0;
  if (input.depthUsd !== undefined && input.depthUsd > 0) {
    depthNorm = clamp01(safeLog10(input.depthUsd / 100_000) / 2);
  }
  
  // If depth available: 60% volume + 40% depth
  // If not: 100% volume
  const score = input.depthUsd !== undefined
    ? 0.6 * volumeNorm + 0.4 * depthNorm
    : volumeNorm;
  
  return {
    score: clamp01(score),
    components: { volumeNorm, depthNorm },
  };
}

// ═══════════════════════════════════════════════════════════════
// DERIVATIVES SCORE
// Formula: 0.5 * oi_norm + 0.3 * oi_delta_norm + 0.2 * funding_abs_norm
// ═══════════════════════════════════════════════════════════════

export interface DerivativesScoreInput {
  openInterestUsd: number;
  oiDelta24h?: number;
  fundingRate?: number;
}

export function computeDerivativesScore(input: DerivativesScoreInput): {
  score: number;
  components: { oiNorm: number; oiDeltaNorm: number; fundingNorm: number };
} {
  // OI normalized: log scale, $20M baseline
  const oiNorm = clamp01(safeLog10(input.openInterestUsd / 10_000_000) / 2);
  
  // OI Delta: percentage change normalized
  const oiDeltaNorm = input.oiDelta24h !== undefined
    ? clamp01(Math.abs(input.oiDelta24h) / 0.5) // 50% change = 1.0
    : 0.5;
  
  // Funding: absolute value, normalized (0.1% = high)
  const fundingNorm = input.fundingRate !== undefined
    ? clamp01(Math.abs(input.fundingRate) / 0.001)
    : 0.5;
  
  const score = 0.5 * oiNorm + 0.3 * oiDeltaNorm + 0.2 * fundingNorm;
  
  return {
    score: clamp01(score),
    components: { oiNorm, oiDeltaNorm, fundingNorm },
  };
}

// ═══════════════════════════════════════════════════════════════
// WHALE SCORE
// Formula: 0.5 * presence + 0.3 * max_position_norm + 0.2 * net_bias_abs_norm
// ═══════════════════════════════════════════════════════════════

export interface WhaleScoreInput {
  whalePresence: boolean;
  whaleCount: number;
  maxPositionUsd?: number;
  netBiasPct?: number;
}

export function computeWhaleScore(input: WhaleScoreInput): {
  score: number;
  components: { presenceNorm: number; maxPosNorm: number; biasNorm: number };
} {
  const presenceNorm = input.whalePresence ? 1.0 : 0.0;
  
  // Max position: $1M baseline, log scale
  const maxPosNorm = input.maxPositionUsd !== undefined && input.maxPositionUsd > 0
    ? clamp01(safeLog10(input.maxPositionUsd / 500_000) / 2)
    : 0;
  
  // Net bias: absolute, higher = more directional conviction
  const biasNorm = input.netBiasPct !== undefined
    ? clamp01(Math.abs(input.netBiasPct))
    : 0;
  
  const score = 0.5 * presenceNorm + 0.3 * maxPosNorm + 0.2 * biasNorm;
  
  return {
    score: clamp01(score),
    components: { presenceNorm, maxPosNorm, biasNorm },
  };
}

// ═══════════════════════════════════════════════════════════════
// UNIVERSE SCORE (FINAL)
// Formula: 0.45 * liquidityScore + 0.35 * derivativesScore + 0.20 * whaleScore
// ═══════════════════════════════════════════════════════════════

export interface UniverseScoreInput {
  liquidityScore: number;
  derivativesScore: number;
  whaleScore: number;
}

export function computeUniverseScore(input: UniverseScoreInput): number {
  return clamp01(
    0.45 * input.liquidityScore +
    0.35 * input.derivativesScore +
    0.20 * input.whaleScore
  );
}

// ═══════════════════════════════════════════════════════════════
// GATES (inclusion rules)
// ═══════════════════════════════════════════════════════════════

export const UNIVERSE_GATES = {
  MIN_LIQUIDITY_SCORE: 0.55,
  MIN_DERIVATIVES_SCORE: 0.40,
  MIN_UNIVERSE_SCORE_INCLUDED: 0.60,
  MIN_UNIVERSE_SCORE_WATCH: 0.40,
} as const;

export function computeGates(scores: UniverseScoreInput): {
  liquidityOk: boolean;
  derivativesOk: boolean;
} {
  return {
    liquidityOk: scores.liquidityScore >= UNIVERSE_GATES.MIN_LIQUIDITY_SCORE,
    derivativesOk: scores.derivativesScore >= UNIVERSE_GATES.MIN_DERIVATIVES_SCORE,
  };
}

export function computeStatus(
  scores: UniverseScoreInput,
  hasVenue: boolean
): { status: 'INCLUDED' | 'WATCH' | 'EXCLUDED'; reasons: string[] } {
  const reasons: string[] = [];
  const universeScore = computeUniverseScore(scores);
  const gates = computeGates(scores);
  
  if (!hasVenue) {
    reasons.push('no_venue_available');
    return { status: 'EXCLUDED', reasons };
  }
  
  if (!gates.liquidityOk) {
    reasons.push('low_liquidity');
  }
  
  if (!gates.derivativesOk) {
    reasons.push('low_derivatives');
  }
  
  if (gates.liquidityOk && universeScore >= UNIVERSE_GATES.MIN_UNIVERSE_SCORE_INCLUDED) {
    if (scores.whaleScore > 0) reasons.push('whale_presence');
    if (scores.derivativesScore > 0.6) reasons.push('strong_derivatives');
    return { status: 'INCLUDED', reasons };
  }
  
  if (universeScore >= UNIVERSE_GATES.MIN_UNIVERSE_SCORE_WATCH) {
    return { status: 'WATCH', reasons };
  }
  
  return { status: 'EXCLUDED', reasons };
}

console.log('[B2] Universe Scoring loaded');
