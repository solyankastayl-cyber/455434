/**
 * BLOCK 37.4 — Pattern Stability Score (PSS) Contracts
 * 
 * PSS measures how robust a match is to small parameter perturbations:
 * - windowLen ± delta
 * - minSimilarity ± delta  
 * - repWeights jitter
 * 
 * A fragile match (PSS < 0.4) gets downweighted.
 */

export interface PssConfig {
  enabled: boolean;
  k: number;                 // number of perturbations (8-16)
  topN: number;              // matches to compare (25)
  
  // perturbation deltas
  windowDeltas: number[];    // [-5, 0, +5]
  simDeltas: number[];       // [-0.02, 0, +0.02]
  repWeightJitter: number;   // 0.05 (±5%)
  
  // scoring weights
  wOverlap: number;          // 0.55 - retrieval stability
  wDirection: number;        // 0.30 - direction consistency
  wScoreStability: number;   // 0.15 - mu/excess stability
}

export interface PssResult {
  pss: number;                    // 0..1 final score
  overlapAvg: number;             // 0..1 Jaccard overlap
  directionConsistency: number;   // 0..1 same direction rate
  scoreStability: number;         // 0..1 low excess variance
  samples: number;                // perturbations run
  notes?: string[];
}

export const DEFAULT_PSS_CONFIG: PssConfig = {
  enabled: true,
  k: 10,
  topN: 25,
  windowDeltas: [-5, 0, 5],
  simDeltas: [-0.02, 0, 0.02],
  repWeightJitter: 0.05,
  wOverlap: 0.55,
  wDirection: 0.30,
  wScoreStability: 0.15,
};

/**
 * Per-match stability config (for individual match PSS)
 */
export interface PatternStabilityConfig {
  enabled: boolean;
  windowDelta: number;       // 5
  similarityDelta: number;   // 0.02
  horizonDelta: number;      // 2
  maxSimStd: number;         // 0.05
  maxMuStd: number;          // 0.03
}

export const DEFAULT_PATTERN_STABILITY_CONFIG: PatternStabilityConfig = {
  enabled: true,
  windowDelta: 5,
  similarityDelta: 0.02,
  horizonDelta: 2,
  maxSimStd: 0.05,
  maxMuStd: 0.03,
};
