/**
 * BLOCK 38.2 — Pattern Decay Contracts
 * 
 * Match weight = age × health × stability × similarity
 * Each component can downweight a fragile/old/unhealthy match.
 */

export interface PatternDecayConfig {
  enabled: boolean;

  // global health multiplier from reliability
  health: {
    min: number;          // 0.60
    max: number;          // 1.00
    power: number;        // 1.0 (optional shaping)
  };

  // match stability -> weight
  stability: {
    enabled: boolean;
    minWeight: number;    // 0.20
    good: number;         // 0.80 (stabilityScore >= good -> ~1.0)
    bad: number;          // 0.30 (stabilityScore <= bad -> ~minWeight)
  };

  // downweight low similarity even after passing floor
  similarity: {
    enabled: boolean;
    knee: number;         // 0.42 (around minSimilarity)
    power: number;        // 1.5
    minWeight: number;    // 0.50
  };
}

export interface MatchWeightBreakdown {
  age: number;
  health: number;
  stability: number;
  similarity: number;
  final: number;
}

export interface WeightedMatch<TMatch> {
  match: TMatch;
  weight: MatchWeightBreakdown;
}

export const DEFAULT_PATTERN_DECAY_CONFIG: PatternDecayConfig = {
  enabled: true,
  health: { min: 0.60, max: 1.00, power: 1.0 },
  stability: { enabled: true, minWeight: 0.20, good: 0.80, bad: 0.30 },
  similarity: { enabled: true, knee: 0.42, power: 1.5, minWeight: 0.50 },
};
