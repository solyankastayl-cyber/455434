/**
 * BLOCK 1.4.7 — Alt Candidates Engine
 * =====================================
 * Finds alt candidates based on pattern similarity to winners.
 */

import { cosineSimilarity, findMostSimilar } from './similarity.js';
import { normalizeVector, FEATURE_NAMES } from './pattern.space.js';
import type { AltFeatureVector } from './contracts/alt.feature.vector.js';
import type { WinnerPattern } from './winner.memory.js';

export interface AltCandidate {
  symbol: string;
  score: number;              // 0..100
  similarity: number;         // 0..1 to best matching winner
  confidence: number;         // 0..1 based on multiple factors

  // Matching info
  matchedWinner: {
    symbol: string;
    returnPct: number;
    fundingLabel: string;
  };

  // Current state
  fundingLabel: string;
  fundingScore: number;

  // Explainability
  reasons: string[];
  topFactors: Array<{
    name: string;
    value: number;
    contribution: number;
  }>;
}

const MIN_SIMILARITY = 0.70;  // Minimum similarity to consider
const MIN_WINNERS = 5;        // Minimum winners needed

/**
 * Find alt candidates similar to winning patterns
 */
export function findAltCandidates(
  current: AltFeatureVector[],
  winners: WinnerPattern[],
  options?: {
    minSimilarity?: number;
    limit?: number;
    fundingFilter?: string;
  }
): AltCandidate[] {
  const minSim = options?.minSimilarity ?? MIN_SIMILARITY;
  const limit = options?.limit ?? 20;

  if (winners.length < MIN_WINNERS) {
    console.log('[AltCandidates] Insufficient winners:', winners.length);
    return [];
  }

  // Optionally filter winners by current funding context
  let filteredWinners = winners;
  if (options?.fundingFilter) {
    filteredWinners = winners.filter(w => w.fundingLabel === options.fundingFilter);
    if (filteredWinners.length < MIN_WINNERS) {
      filteredWinners = winners; // Fallback to all
    }
  }

  const candidates: AltCandidate[] = [];

  for (const alt of current) {
    const altVector = normalizeVector(alt);

    // Find best matching winner
    let bestSim = 0;
    let bestWinner: WinnerPattern | null = null;

    for (const winner of filteredWinners) {
      const sim = cosineSimilarity(altVector, winner.vector);
      if (sim > bestSim) {
        bestSim = sim;
        bestWinner = winner;
      }
    }

    if (bestSim < minSim || !bestWinner) continue;

    // Calculate score
    const score = calculateScore(bestSim, alt, bestWinner);
    
    // Calculate confidence
    const confidence = calculateConfidence(bestSim, alt, filteredWinners);

    // Build reasons
    const reasons = buildReasons(alt, bestWinner, bestSim);

    // Get top contributing factors
    const topFactors = getTopFactors(altVector, bestWinner.vector);

    candidates.push({
      symbol: alt.symbol,
      score,
      similarity: bestSim,
      confidence,
      matchedWinner: {
        symbol: bestWinner.symbol,
        returnPct: bestWinner.returnPct,
        fundingLabel: bestWinner.fundingLabel,
      },
      fundingLabel: alt.fundingLabel,
      fundingScore: alt.fundingScore,
      reasons,
      topFactors,
    });
  }

  // Sort by score and limit
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function calculateScore(
  similarity: number,
  alt: AltFeatureVector,
  winner: WinnerPattern
): number {
  let score = similarity * 100;

  // Boost if funding context matches
  if (alt.fundingLabel === winner.fundingLabel) {
    score *= 1.1;
  }

  // Penalty for extreme funding (risky)
  if (alt.fundingLabel === 'OVERLONG' || alt.fundingLabel === 'OVERSHORT') {
    score *= 0.85;
  }

  // Boost for good coverage
  score *= (0.5 + alt.coverage * 0.5);

  return Math.min(100, Math.round(score * 10) / 10);
}

function calculateConfidence(
  similarity: number,
  alt: AltFeatureVector,
  winners: WinnerPattern[]
): number {
  // Base confidence from similarity
  let conf = similarity;

  // Boost from data coverage
  conf *= (0.7 + alt.coverage * 0.3);

  // Boost from multiple similar winners
  const similarCount = winners.filter(w => 
    cosineSimilarity(normalizeVector(alt), w.vector) > MIN_SIMILARITY
  ).length;
  
  if (similarCount >= 3) conf *= 1.1;
  if (similarCount >= 5) conf *= 1.1;

  return Math.min(1, Math.round(conf * 100) / 100);
}

function buildReasons(
  alt: AltFeatureVector,
  winner: WinnerPattern,
  similarity: number
): string[] {
  const reasons: string[] = [];

  reasons.push(`Similar to ${winner.symbol} pattern (+${(winner.returnPct * 100).toFixed(1)}%)`);
  reasons.push(`Pattern match: ${(similarity * 100).toFixed(0)}%`);

  if (alt.fundingLabel === winner.fundingLabel) {
    reasons.push(`Same funding context: ${alt.fundingLabel}`);
  }

  if (alt.rsi < 35) {
    reasons.push('RSI oversold zone');
  } else if (alt.rsi > 70) {
    reasons.push('RSI overbought zone');
  }

  if (Math.abs(alt.fundingScore) > 0.5) {
    const dir = alt.fundingScore > 0 ? 'long' : 'short';
    reasons.push(`Crowded ${dir} trade`);
  }

  if (alt.squeezeScore > 0.6) {
    reasons.push('Volatility squeeze setup');
  }

  if (alt.breakoutScore > 0.7) {
    reasons.push('Breakout pattern detected');
  }

  return reasons.slice(0, 5);
}

function getTopFactors(
  altVector: number[],
  winnerVector: number[]
): AltCandidate['topFactors'] {
  const contributions: Array<{
    name: string;
    value: number;
    contribution: number;
  }> = [];

  for (let i = 0; i < altVector.length; i++) {
    // Contribution = similarity of this feature
    const contribution = 1 - Math.abs(altVector[i] - winnerVector[i]);
    
    contributions.push({
      name: FEATURE_NAMES[i],
      value: Math.round(altVector[i] * 100) / 100,
      contribution: Math.round(contribution * 100) / 100,
    });
  }

  return contributions
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5);
}

console.log('[Screener] Alt Candidates Engine loaded');
