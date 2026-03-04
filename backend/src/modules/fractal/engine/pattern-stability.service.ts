/**
 * BLOCK 37.4 — Pattern Stability Score Service
 * 
 * Computes stability of a signal/match set by running K perturbations
 * and measuring:
 * 1. Retrieval overlap (Jaccard)
 * 2. Direction consistency (LONG/SHORT/NEUTRAL)
 * 3. Score stability (mu/excess variance)
 */

import { PssConfig, PssResult, DEFAULT_PSS_CONFIG } from '../contracts/pss.contracts.js';
import { clamp01, jaccard, jitterWeights, mean, stdev } from './pss.utils.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type SignalDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

interface MatchResult {
  key: string;      // unique match identifier (e.g., startTs-endTs)
  sim: number;
  mu?: number;
  excess?: number;
  side?: SignalDirection;
}

interface MatchRunResult {
  matches: MatchResult[];
  side: SignalDirection;
  mu: number;
  excess: number;
}

export interface PssDeps {
  runMatch: (req: any) => Promise<MatchRunResult>;
  rnd?: () => number;
}

// ═══════════════════════════════════════════════════════════════
// Direction Compatibility
// ═══════════════════════════════════════════════════════════════

function directionCompat(a: SignalDirection, b: SignalDirection): number {
  if (a === b) return 1;
  if (a === 'NEUTRAL' || b === 'NEUTRAL') return 0.5;
  return 0; // LONG vs SHORT
}

// ═══════════════════════════════════════════════════════════════
// PSS Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Compute Pattern Stability Score
 * 
 * Runs K perturbations around base params and measures:
 * - overlap: how many top matches stay the same
 * - direction: does signal direction flip
 * - score: is mu/excess stable
 */
export async function computePss(
  deps: PssDeps,
  baseReq: any,
  cfg: PssConfig = DEFAULT_PSS_CONFIG
): Promise<PssResult> {
  if (!cfg.enabled) {
    return {
      pss: 1,
      overlapAvg: 1,
      directionConsistency: 1,
      scoreStability: 1,
      samples: 0,
      notes: ['disabled'],
    };
  }

  const rnd = deps.rnd ?? Math.random;

  // Base run
  let base: MatchRunResult;
  try {
    base = await deps.runMatch(baseReq);
  } catch (e) {
    return {
      pss: 0.5,
      overlapAvg: 0.5,
      directionConsistency: 0.5,
      scoreStability: 0.5,
      samples: 0,
      notes: ['base_run_failed'],
    };
  }

  const baseSet = new Set(
    base.matches.slice(0, cfg.topN).map(m => m.key)
  );

  const overlapScores: number[] = [];
  const dirScores: number[] = [];
  const muExcess: number[] = [];

  let used = 0;

  for (let i = 0; i < cfg.k; i++) {
    // Choose perturbation deltas (cycle through options)
    const wd = cfg.windowDeltas[(i + 7) % cfg.windowDeltas.length];
    const sd = cfg.simDeltas[(i + 3) % cfg.simDeltas.length];

    const pertReq = { ...baseReq };

    // Apply window delta
    if (typeof pertReq.windowLen === 'number') {
      pertReq.windowLen = Math.max(20, pertReq.windowLen + wd);
    }

    // Apply similarity threshold delta
    if (typeof pertReq.minSimilarity === 'number') {
      pertReq.minSimilarity = Math.max(0.10, pertReq.minSimilarity + sd);
    }

    // Apply weight jitter (if multi-rep)
    if (pertReq.repWeights && typeof pertReq.repWeights.ret === 'number') {
      pertReq.repWeights = jitterWeights(pertReq.repWeights, cfg.repWeightJitter, rnd);
    }

    try {
      const r = await deps.runMatch(pertReq);
      used++;

      // Overlap score (Jaccard)
      const set = new Set(r.matches.slice(0, cfg.topN).map(m => m.key));
      overlapScores.push(jaccard(baseSet, set));

      // Direction consistency
      const d = directionCompat(base.side, r.side);
      dirScores.push(d);

      // Score stability (excess variance)
      muExcess.push(r.excess ?? 0);
    } catch (e) {
      // Skip failed perturbation
      continue;
    }
  }

  if (used === 0) {
    return {
      pss: 0.3,
      overlapAvg: 0.3,
      directionConsistency: 0.5,
      scoreStability: 0.5,
      samples: 0,
      notes: ['all_perturbations_failed'],
    };
  }

  const overlapAvg = mean(overlapScores);
  const directionConsistency = mean(dirScores);

  // Lower stdev(excess) is better; normalize to [0,1]
  const exStd = stdev(muExcess);
  const scoreStability = clamp01(1 - exStd / 0.02); // 2% std => 0

  const pss =
    cfg.wOverlap * overlapAvg +
    cfg.wDirection * directionConsistency +
    cfg.wScoreStability * scoreStability;

  return {
    pss: clamp01(pss),
    overlapAvg: clamp01(overlapAvg),
    directionConsistency: clamp01(directionConsistency),
    scoreStability: clamp01(scoreStability),
    samples: used,
  };
}

// ═══════════════════════════════════════════════════════════════
// Per-Match Stability Score
// ═══════════════════════════════════════════════════════════════

import { PatternStabilityConfig, DEFAULT_PATTERN_STABILITY_CONFIG } from '../contracts/pss.contracts.js';

interface MatchStabilityDeps {
  getMatchAtParams: (params: any) => Promise<{ similarity: number; mu: number; direction: SignalDirection } | null>;
}

/**
 * Compute stability score for a single match
 * Tests if match survives small parameter changes
 */
export async function computeMatchStability(
  deps: MatchStabilityDeps,
  baseParams: { windowLen: number; minSimilarity: number; matchId: string; asOf?: Date },
  baseMatch: { similarity: number; mu: number; direction: SignalDirection },
  cfg: PatternStabilityConfig = DEFAULT_PATTERN_STABILITY_CONFIG
): Promise<number> {
  if (!cfg.enabled) return 1;

  const sims: number[] = [];
  const mus: number[] = [];
  let flip = false;

  const perturbations = [
    { windowLen: baseParams.windowLen - cfg.windowDelta },
    { windowLen: baseParams.windowLen + cfg.windowDelta },
    { minSimilarity: baseParams.minSimilarity - cfg.similarityDelta },
    { minSimilarity: baseParams.minSimilarity + cfg.similarityDelta },
  ];

  for (const p of perturbations) {
    const testParams = { ...baseParams, ...p };
    testParams.windowLen = Math.max(20, testParams.windowLen);
    testParams.minSimilarity = Math.max(0.10, testParams.minSimilarity);

    try {
      const res = await deps.getMatchAtParams(testParams);
      if (!res) continue;

      sims.push(res.similarity);
      mus.push(res.mu);

      if (Math.sign(res.mu) !== Math.sign(baseMatch.mu)) {
        flip = true;
      }
    } catch {
      continue;
    }
  }

  if (sims.length === 0) return 0.3; // fragile fallback

  const simStd = stdev(sims);
  const muStd = stdev(mus);

  const simScore = Math.exp(-simStd / cfg.maxSimStd);
  const muScore = Math.exp(-muStd / cfg.maxMuStd);
  const dirScore = flip ? 0 : 1;

  const pss = 0.4 * simScore + 0.4 * muScore + 0.2 * dirScore;

  return clamp01(pss);
}

/**
 * Compute stability scores for top matches (batch)
 * Limited to top N for performance
 */
export async function computeBatchMatchStability<T extends { similarity: number; mu: number; direction?: SignalDirection }>(
  matches: T[],
  baseParams: { windowLen: number; minSimilarity: number; asOf?: Date },
  cfg: PatternStabilityConfig = DEFAULT_PATTERN_STABILITY_CONFIG,
  limit = 10
): Promise<Map<number, number>> {
  const results = new Map<number, number>();
  
  // Only compute for top N matches (performance)
  const toCompute = matches.slice(0, limit);
  
  for (let i = 0; i < toCompute.length; i++) {
    const match = toCompute[i];
    
    // Simplified stability based on similarity variance heuristic
    // Full PSS would require re-running match queries
    const simVariance = Math.abs(match.similarity - 0.5) * 0.2;
    const muVariance = Math.abs(match.mu) < 0.02 ? 0.2 : 0;
    
    // Heuristic: higher similarity = more stable
    const stabilityHeuristic = clamp01(
      0.3 + 
      0.4 * match.similarity + 
      0.2 * (1 - simVariance) +
      0.1 * (1 - muVariance)
    );
    
    results.set(i, stabilityHeuristic);
  }
  
  // Fill remaining with default
  for (let i = limit; i < matches.length; i++) {
    results.set(i, 0.7);
  }
  
  return results;
}
