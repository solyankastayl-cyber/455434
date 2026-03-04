/**
 * BLOCK 36.1 — Pattern Age Decay
 * 
 * Matches from distant past should weigh less.
 * This prevents over-reliance on ancient patterns that may
 * no longer be relevant to current market structure.
 * 
 * Formula: w_age = exp(-lambda * ageYears)
 * 
 * With lambda=0.12:
 * - 1 year old: 0.89 weight
 * - 3 years old: 0.70 weight  
 * - 5 years old: 0.55 weight
 * - 10 years old: 0.30 weight
 * 
 * Half-life = ln(2) / lambda ≈ 5.8 years
 */

export interface AgeDecayConfig {
  enabled: boolean;
  lambda: number;  // decay rate (0.12 = ~5.8 year half-life)
}

export const DEFAULT_AGE_DECAY: AgeDecayConfig = {
  enabled: true,
  lambda: 0.12,
};

/**
 * Calculate age-based decay weight for a match
 * 
 * @param matchEndTs - Timestamp when the historical pattern ended
 * @param asOfTs - Current timestamp (when we're making prediction)
 * @param lambda - Decay rate (default 0.12)
 * @returns Weight in range (0, 1]
 */
export function ageDecayWeight(
  matchEndTs: number | Date,
  asOfTs: number | Date,
  lambda: number = 0.12
): number {
  const matchEnd = typeof matchEndTs === 'number' ? matchEndTs : matchEndTs.getTime();
  const asOf = typeof asOfTs === 'number' ? asOfTs : asOfTs.getTime();
  
  const ageMs = Math.max(0, asOf - matchEnd);
  const ageYears = ageMs / (365.25 * 24 * 3600 * 1000);
  
  return Math.exp(-lambda * ageYears);
}

/**
 * Calculate half-life from lambda
 */
export function getHalfLifeYears(lambda: number): number {
  return Math.log(2) / lambda;
}

/**
 * Calculate lambda from desired half-life
 */
export function getLambdaFromHalfLife(halfLifeYears: number): number {
  return Math.log(2) / halfLifeYears;
}

/**
 * Apply age decay to a similarity score
 */
export function applyAgeDecay(
  rawSimilarity: number,
  matchEndTs: number | Date,
  asOfTs: number | Date,
  config: AgeDecayConfig = DEFAULT_AGE_DECAY
): {
  rawSimilarity: number;
  ageWeight: number;
  finalScore: number;
  ageYears: number;
} {
  if (!config.enabled) {
    return {
      rawSimilarity,
      ageWeight: 1.0,
      finalScore: rawSimilarity,
      ageYears: 0,
    };
  }
  
  const matchEnd = typeof matchEndTs === 'number' ? matchEndTs : matchEndTs.getTime();
  const asOf = typeof asOfTs === 'number' ? asOfTs : asOfTs.getTime();
  
  const ageMs = Math.max(0, asOf - matchEnd);
  const ageYears = ageMs / (365.25 * 24 * 3600 * 1000);
  const ageWeight = Math.exp(-config.lambda * ageYears);
  
  return {
    rawSimilarity,
    ageWeight: Math.round(ageWeight * 1000) / 1000,
    finalScore: rawSimilarity * ageWeight,
    ageYears: Math.round(ageYears * 100) / 100,
  };
}

/**
 * Batch apply age decay to multiple matches
 */
export function applyAgeDecayToMatches<T extends { similarity: number; endTs: number | Date }>(
  matches: T[],
  asOfTs: number | Date,
  config: AgeDecayConfig = DEFAULT_AGE_DECAY
): (T & { ageWeight: number; finalScore: number; ageYears: number })[] {
  return matches.map(match => {
    const decay = applyAgeDecay(match.similarity, match.endTs, asOfTs, config);
    return {
      ...match,
      ageWeight: decay.ageWeight,
      finalScore: decay.finalScore,
      ageYears: decay.ageYears,
    };
  });
}

/**
 * Re-rank matches by age-adjusted score
 */
export function rankByAgeAdjustedScore<T extends { similarity: number; endTs: number | Date }>(
  matches: T[],
  asOfTs: number | Date,
  config: AgeDecayConfig = DEFAULT_AGE_DECAY
): (T & { ageWeight: number; finalScore: number; ageYears: number; rank: number })[] {
  const withDecay = applyAgeDecayToMatches(matches, asOfTs, config);
  
  // Sort by finalScore descending
  withDecay.sort((a, b) => b.finalScore - a.finalScore);
  
  // Add rank
  return withDecay.map((m, idx) => ({ ...m, rank: idx + 1 }));
}
