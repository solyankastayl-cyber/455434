/**
 * BLOCK 73.1 — Primary Match Selection Engine
 * 
 * Institutional-grade weighted scoring for selecting the single
 * "Primary Match" from a pool of top candidates.
 * 
 * This replaces naive topMatches[0] with a multi-criteria
 * selection algorithm that considers:
 * - Similarity score (DTW/correlation)
 * - Volatility alignment
 * - Stability/consistency
 * - Outcome quality (risk-adjusted returns)
 * - Recency bias (more recent = more relevant)
 * 
 * The Primary Match is used for:
 * - Replay mode visualization
 * - Hybrid mode comparison
 * - Confidence calibration
 */

import type { OverlayMatch } from '../focus/focus.types.js';
import type { HorizonKey } from '../config/horizon.config.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface PrimaryMatch extends OverlayMatch {
  // Selection metadata
  selectionScore: number;        // Composite weighted score (0..1)
  selectionRank: number;         // 1 = best
  
  // Component scores (for transparency)
  scores: {
    similarity: number;          // Raw similarity (0..1)
    volatilityAlignment: number; // How well volatility matches (0..1)
    stabilityScore: number;      // Pattern stability (0..1)
    outcomeQuality: number;      // Risk-adjusted aftermath quality (0..1)
    recencyBonus: number;        // Recency factor (0..1)
  };
  
  // Selection reasoning (for UI/debugging)
  selectionReason: string;
}

export interface SelectionWeights {
  similarity: number;
  volatilityAlignment: number;
  stability: number;
  outcomeQuality: number;
  recency: number;
}

export interface PrimarySelectionResult {
  primaryMatch: PrimaryMatch | null;
  candidateCount: number;
  selectionMethod: 'WEIGHTED_SCORE' | 'FALLBACK_FIRST' | 'NO_CANDIDATES';
  processingTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════
// WEIGHT CONFIGURATIONS BY HORIZON TIER
// ═══════════════════════════════════════════════════════════════

/**
 * Horizon-specific weight profiles:
 * - TIMING (7d, 14d): Prioritize similarity + recency
 * - TACTICAL (30d, 90d): Balanced approach
 * - STRUCTURE (180d, 365d): Prioritize stability + outcome quality
 */
const TIER_WEIGHTS: Record<'TIMING' | 'TACTICAL' | 'STRUCTURE', SelectionWeights> = {
  TIMING: {
    similarity: 0.35,
    volatilityAlignment: 0.20,
    stability: 0.15,
    outcomeQuality: 0.15,
    recency: 0.15,
  },
  TACTICAL: {
    similarity: 0.30,
    volatilityAlignment: 0.20,
    stability: 0.20,
    outcomeQuality: 0.20,
    recency: 0.10,
  },
  STRUCTURE: {
    similarity: 0.25,
    volatilityAlignment: 0.15,
    stability: 0.25,
    outcomeQuality: 0.25,
    recency: 0.10,
  },
};

function getWeightsForHorizon(horizon: HorizonKey): SelectionWeights {
  if (['7d', '14d'].includes(horizon)) return TIER_WEIGHTS.TIMING;
  if (['30d', '90d'].includes(horizon)) return TIER_WEIGHTS.TACTICAL;
  return TIER_WEIGHTS.STRUCTURE;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT SCORE CALCULATORS
// ═══════════════════════════════════════════════════════════════

/**
 * Normalize similarity score (already 0..1 from engine)
 */
function calcSimilarityScore(match: OverlayMatch): number {
  return Math.min(1, Math.max(0, match.similarity));
}

/**
 * Calculate volatility alignment score
 * Higher = better match between current and historical volatility
 */
function calcVolatilityAlignmentScore(match: OverlayMatch): number {
  return Math.min(1, Math.max(0, match.volatilityMatch));
}

/**
 * Calculate stability score
 * Stable patterns = consistent aftermath trajectories
 */
function calcStabilityScore(match: OverlayMatch): number {
  // Use existing stability if available
  if (match.stability !== undefined) {
    return Math.min(1, Math.max(0, match.stability));
  }
  
  // Fallback: derive from drawdown shape consistency
  const ddShape = match.drawdownShape || 0.5;
  return Math.min(1, Math.max(0, ddShape));
}

/**
 * Calculate outcome quality (risk-adjusted)
 * Good outcome = positive return with controlled drawdown
 */
function calcOutcomeQualityScore(match: OverlayMatch): number {
  const ret = match.return || 0;
  const maxDD = match.maxDrawdown || 0;
  const mfe = match.maxExcursion || 0;
  
  // Return component: sigmoid-like transformation
  // Maps return to 0..1, with 0 return = 0.5
  const returnScore = 1 / (1 + Math.exp(-ret * 10));
  
  // Risk component: lower drawdown = higher score
  const riskScore = 1 - Math.min(1, maxDD * 2);
  
  // Opportunity component: higher MFE = better
  const opportunityScore = Math.min(1, mfe * 2);
  
  // Composite: weighted average
  return (returnScore * 0.5) + (riskScore * 0.3) + (opportunityScore * 0.2);
}

/**
 * Calculate recency bonus
 * More recent matches get slight preference (market structure evolves)
 */
function calcRecencyBonus(match: OverlayMatch, oldestId: string, newestId: string): number {
  // Parse years from match ID (format: YYYY-MM-DD)
  const matchYear = parseInt(match.id.substring(0, 4), 10);
  const oldestYear = parseInt(oldestId.substring(0, 4), 10);
  const newestYear = parseInt(newestId.substring(0, 4), 10);
  
  const yearRange = Math.max(1, newestYear - oldestYear);
  const matchPosition = matchYear - oldestYear;
  
  // Linear interpolation: oldest = 0, newest = 1
  return Math.min(1, Math.max(0, matchPosition / yearRange));
}

// ═══════════════════════════════════════════════════════════════
// PRIMARY SELECTION ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Select the Primary Match from a pool of candidates
 * using weighted multi-criteria scoring
 */
export function selectPrimaryMatch(
  matches: OverlayMatch[],
  horizon: HorizonKey
): PrimarySelectionResult {
  const t0 = Date.now();
  
  // Edge case: no candidates
  if (!matches || matches.length === 0) {
    return {
      primaryMatch: null,
      candidateCount: 0,
      selectionMethod: 'NO_CANDIDATES',
      processingTimeMs: Date.now() - t0,
    };
  }
  
  // Edge case: single candidate
  if (matches.length === 1) {
    const single = matches[0];
    const primaryMatch: PrimaryMatch = {
      ...single,
      selectionScore: 1.0,
      selectionRank: 1,
      scores: {
        similarity: calcSimilarityScore(single),
        volatilityAlignment: calcVolatilityAlignmentScore(single),
        stabilityScore: calcStabilityScore(single),
        outcomeQuality: calcOutcomeQualityScore(single),
        recencyBonus: 0.5, // Neutral for single
      },
      selectionReason: 'SINGLE_CANDIDATE',
    };
    
    return {
      primaryMatch,
      candidateCount: 1,
      selectionMethod: 'FALLBACK_FIRST',
      processingTimeMs: Date.now() - t0,
    };
  }
  
  // Get weights for this horizon
  const weights = getWeightsForHorizon(horizon);
  
  // Find oldest and newest match IDs for recency calculation
  const sortedByDate = [...matches].sort((a, b) => a.id.localeCompare(b.id));
  const oldestId = sortedByDate[0].id;
  const newestId = sortedByDate[sortedByDate.length - 1].id;
  
  // Score all candidates
  const scored: Array<{
    match: OverlayMatch;
    scores: PrimaryMatch['scores'];
    totalScore: number;
  }> = matches.map(match => {
    const scores = {
      similarity: calcSimilarityScore(match),
      volatilityAlignment: calcVolatilityAlignmentScore(match),
      stabilityScore: calcStabilityScore(match),
      outcomeQuality: calcOutcomeQualityScore(match),
      recencyBonus: calcRecencyBonus(match, oldestId, newestId),
    };
    
    // Weighted sum
    const totalScore = 
      (scores.similarity * weights.similarity) +
      (scores.volatilityAlignment * weights.volatilityAlignment) +
      (scores.stabilityScore * weights.stability) +
      (scores.outcomeQuality * weights.outcomeQuality) +
      (scores.recencyBonus * weights.recency);
    
    return { match, scores, totalScore };
  });
  
  // Sort by total score (descending)
  scored.sort((a, b) => b.totalScore - a.totalScore);
  
  // Select the winner
  const winner = scored[0];
  
  // Determine selection reason
  let selectionReason = 'WEIGHTED_COMPOSITE';
  const topScore = winner.scores;
  
  // Find dominant factor
  const factors = [
    { name: 'HIGH_SIMILARITY', value: topScore.similarity * weights.similarity },
    { name: 'VOLATILITY_MATCH', value: topScore.volatilityAlignment * weights.volatilityAlignment },
    { name: 'PATTERN_STABILITY', value: topScore.stabilityScore * weights.stability },
    { name: 'OUTCOME_QUALITY', value: topScore.outcomeQuality * weights.outcomeQuality },
    { name: 'RECENCY', value: topScore.recencyBonus * weights.recency },
  ];
  
  factors.sort((a, b) => b.value - a.value);
  if (factors[0].value > factors[1].value * 1.5) {
    selectionReason = factors[0].name;
  }
  
  const primaryMatch: PrimaryMatch = {
    ...winner.match,
    selectionScore: Math.round(winner.totalScore * 1000) / 1000,
    selectionRank: 1,
    scores: {
      similarity: Math.round(topScore.similarity * 1000) / 1000,
      volatilityAlignment: Math.round(topScore.volatilityAlignment * 1000) / 1000,
      stabilityScore: Math.round(topScore.stabilityScore * 1000) / 1000,
      outcomeQuality: Math.round(topScore.outcomeQuality * 1000) / 1000,
      recencyBonus: Math.round(topScore.recencyBonus * 1000) / 1000,
    },
    selectionReason,
  };
  
  return {
    primaryMatch,
    candidateCount: matches.length,
    selectionMethod: 'WEIGHTED_SCORE',
    processingTimeMs: Date.now() - t0,
  };
}

/**
 * Get ranked list of all candidates (for debugging/admin UI)
 */
export function rankAllMatches(
  matches: OverlayMatch[],
  horizon: HorizonKey
): PrimaryMatch[] {
  if (!matches || matches.length === 0) return [];
  
  const weights = getWeightsForHorizon(horizon);
  
  const sortedByDate = [...matches].sort((a, b) => a.id.localeCompare(b.id));
  const oldestId = sortedByDate[0].id;
  const newestId = sortedByDate[sortedByDate.length - 1].id;
  
  const scored = matches.map(match => {
    const scores = {
      similarity: calcSimilarityScore(match),
      volatilityAlignment: calcVolatilityAlignmentScore(match),
      stabilityScore: calcStabilityScore(match),
      outcomeQuality: calcOutcomeQualityScore(match),
      recencyBonus: calcRecencyBonus(match, oldestId, newestId),
    };
    
    const totalScore = 
      (scores.similarity * weights.similarity) +
      (scores.volatilityAlignment * weights.volatilityAlignment) +
      (scores.stabilityScore * weights.stability) +
      (scores.outcomeQuality * weights.outcomeQuality) +
      (scores.recencyBonus * weights.recency);
    
    return { match, scores, totalScore };
  });
  
  scored.sort((a, b) => b.totalScore - a.totalScore);
  
  return scored.map((s, idx) => ({
    ...s.match,
    selectionScore: Math.round(s.totalScore * 1000) / 1000,
    selectionRank: idx + 1,
    scores: {
      similarity: Math.round(s.scores.similarity * 1000) / 1000,
      volatilityAlignment: Math.round(s.scores.volatilityAlignment * 1000) / 1000,
      stabilityScore: Math.round(s.scores.stabilityScore * 1000) / 1000,
      outcomeQuality: Math.round(s.scores.outcomeQuality * 1000) / 1000,
      recencyBonus: Math.round(s.scores.recencyBonus * 1000) / 1000,
    },
    selectionReason: idx === 0 ? 'PRIMARY_SELECTED' : `RANK_${idx + 1}`,
  }));
}
