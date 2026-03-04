/**
 * SPX CORE — Primary Match Selector
 * 
 * BLOCK B5.2.3 — Weighted Multi-Criteria Selection
 * 
 * Selects the best "Primary Match" from candidates using weighted scoring.
 * ISOLATION: Does NOT import from /modules/btc/ or /modules/fractal/
 */

import type { SpxRawMatch } from './spx-scan.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SpxHorizonTier = 'TIMING' | 'TACTICAL' | 'STRUCTURE';

export interface SpxPrimaryMatch extends SpxRawMatch {
  selectionScore: number;      // Composite weighted score (0-1)
  selectionRank: number;       // 1 = best
  scores: {
    similarity: number;
    volatilityAlignment: number;
    stabilityScore: number;
    outcomeQuality: number;
    recencyBonus: number;
  };
  selectionReason: string;
}

export interface SpxPrimarySelectionResult {
  primaryMatch: SpxPrimaryMatch | null;
  candidateCount: number;
  selectionMethod: 'WEIGHTED_SCORE' | 'FALLBACK_FIRST' | 'NO_CANDIDATES';
  processingTimeMs: number;
}

interface SelectionWeights {
  similarity: number;
  volatilityAlignment: number;
  stability: number;
  outcomeQuality: number;
  recency: number;
}

// ═══════════════════════════════════════════════════════════════
// WEIGHT CONFIGURATIONS BY TIER
// ═══════════════════════════════════════════════════════════════

const TIER_WEIGHTS: Record<SpxHorizonTier, SelectionWeights> = {
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

// ═══════════════════════════════════════════════════════════════
// TIER MAPPING
// ═══════════════════════════════════════════════════════════════

export function getHorizonTier(horizonKey: string): SpxHorizonTier {
  const days = parseInt(horizonKey.replace('d', ''), 10);
  
  if (days <= 14) return 'TIMING';
  if (days <= 90) return 'TACTICAL';
  return 'STRUCTURE';
}

// ═══════════════════════════════════════════════════════════════
// SCORE CALCULATORS
// ═══════════════════════════════════════════════════════════════

function calcSimilarityScore(match: SpxRawMatch): number {
  // Normalize to 0-1 (similarity is 0-100)
  return Math.min(1, Math.max(0, match.similarity / 100));
}

function calcVolatilityAlignmentScore(match: SpxRawMatch): number {
  // Use correlation as proxy for volatility alignment
  // Correlation ranges -1 to 1, normalize to 0-1
  const corr = match.correlation || 0;
  return Math.min(1, Math.max(0, (corr + 1) / 2));
}

function calcStabilityScore(match: SpxRawMatch): number {
  // Stability = inverse of drawdown relative to return
  const ret = Math.abs(match.return);
  const dd = match.maxDrawdown;
  
  if (ret === 0 && dd === 0) return 0.5;
  if (dd === 0) return 1;
  
  // Risk-adjusted stability
  const ratio = ret / (dd + 1);
  return Math.min(1, ratio / 3); // Normalize: ratio of 3 = perfect score
}

function calcOutcomeQualityScore(match: SpxRawMatch): number {
  const ret = match.return;
  const maxDD = match.maxDrawdown;
  const mfe = match.maxExcursion;
  
  // Return component: sigmoid transformation
  // Maps return to 0-1, 0% return = 0.5
  const returnScore = 1 / (1 + Math.exp(-ret / 5));
  
  // Risk component: lower drawdown = higher score
  const riskScore = Math.max(0, 1 - maxDD / 50);
  
  // Opportunity component: higher MFE = better
  const opportunityScore = Math.min(1, mfe / 30);
  
  return (returnScore * 0.5) + (riskScore * 0.3) + (opportunityScore * 0.2);
}

function calcRecencyBonus(match: SpxRawMatch, oldestId: string, newestId: string): number {
  // Parse years from match ID (format: YYYY-MM-DD)
  const matchYear = parseInt(match.id.substring(0, 4), 10);
  const oldestYear = parseInt(oldestId.substring(0, 4), 10);
  const newestYear = parseInt(newestId.substring(0, 4), 10);
  
  const yearRange = Math.max(1, newestYear - oldestYear);
  const matchPosition = matchYear - oldestYear;
  
  return Math.min(1, Math.max(0, matchPosition / yearRange));
}

// ═══════════════════════════════════════════════════════════════
// PRIMARY SELECTION ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Select the Primary Match from candidates using weighted scoring
 */
export function selectPrimaryMatch(
  matches: SpxRawMatch[],
  horizonKey: string
): SpxPrimarySelectionResult {
  const t0 = Date.now();
  
  // No candidates
  if (!matches || matches.length === 0) {
    return {
      primaryMatch: null,
      candidateCount: 0,
      selectionMethod: 'NO_CANDIDATES',
      processingTimeMs: Date.now() - t0,
    };
  }
  
  // Single candidate
  if (matches.length === 1) {
    const single = matches[0];
    const primaryMatch: SpxPrimaryMatch = {
      ...single,
      selectionScore: 1.0,
      selectionRank: 1,
      scores: {
        similarity: calcSimilarityScore(single),
        volatilityAlignment: calcVolatilityAlignmentScore(single),
        stabilityScore: calcStabilityScore(single),
        outcomeQuality: calcOutcomeQualityScore(single),
        recencyBonus: 0.5,
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
  const tier = getHorizonTier(horizonKey);
  const weights = TIER_WEIGHTS[tier];
  
  // Find oldest and newest for recency
  const sortedByDate = [...matches].sort((a, b) => a.id.localeCompare(b.id));
  const oldestId = sortedByDate[0].id;
  const newestId = sortedByDate[sortedByDate.length - 1].id;
  
  // Score all candidates
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
  
  // Sort by total score
  scored.sort((a, b) => b.totalScore - a.totalScore);
  
  const winner = scored[0];
  
  // Determine selection reason
  let selectionReason = 'WEIGHTED_COMPOSITE';
  const factors = [
    { name: 'HIGH_SIMILARITY', value: winner.scores.similarity * weights.similarity },
    { name: 'VOLATILITY_MATCH', value: winner.scores.volatilityAlignment * weights.volatilityAlignment },
    { name: 'PATTERN_STABILITY', value: winner.scores.stabilityScore * weights.stability },
    { name: 'OUTCOME_QUALITY', value: winner.scores.outcomeQuality * weights.outcomeQuality },
    { name: 'RECENCY', value: winner.scores.recencyBonus * weights.recency },
  ];
  
  factors.sort((a, b) => b.value - a.value);
  if (factors[0].value > factors[1].value * 1.5) {
    selectionReason = factors[0].name;
  }
  
  const primaryMatch: SpxPrimaryMatch = {
    ...winner.match,
    selectionScore: Math.round(winner.totalScore * 1000) / 1000,
    selectionRank: 1,
    scores: {
      similarity: Math.round(winner.scores.similarity * 1000) / 1000,
      volatilityAlignment: Math.round(winner.scores.volatilityAlignment * 1000) / 1000,
      stabilityScore: Math.round(winner.scores.stabilityScore * 1000) / 1000,
      outcomeQuality: Math.round(winner.scores.outcomeQuality * 1000) / 1000,
      recencyBonus: Math.round(winner.scores.recencyBonus * 1000) / 1000,
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
 * Get ranked list of all candidates
 */
export function rankAllMatches(
  matches: SpxRawMatch[],
  horizonKey: string
): SpxPrimaryMatch[] {
  if (!matches || matches.length === 0) return [];
  
  const tier = getHorizonTier(horizonKey);
  const weights = TIER_WEIGHTS[tier];
  
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

export default {
  selectPrimaryMatch,
  rankAllMatches,
  getHorizonTier,
};
