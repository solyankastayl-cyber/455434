/**
 * Phase D: Beam Search
 * 
 * OPTIMIZATION: 10^6 combinations → ~600 expansions
 * 
 * Algorithm:
 * 1. Keep beam of top B hypotheses
 * 2. For each group, take top K candidates
 * 3. Try adding each candidate to each hypothesis
 * 4. Score and prune to top B
 * 5. Repeat for all groups
 */

import { Hypothesis, GroupBucket, PatternCandidate } from './hypothesis_types.js';

export type BeamSearchOpts = {
  beamWidth: number;     // B (e.g., 20)
  perGroupK: number;     // K (e.g., 3)
};

export type TryAddFn = (hyp: Hypothesis, cand: PatternCandidate) => 
  { ok: true; hyp: Hypothesis } | { ok: false; reason: string };

export type ScoreFn = (hyp: Hypothesis) => Hypothesis;

/**
 * Stable sort: by score desc, then by id for determinism
 */
function stableSort<T>(arr: T[], key: (x: T) => number, tie: (x: T) => string): T[] {
  return [...arr].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (kb !== ka) return kb - ka;
    const ta = tie(a), tb = tie(b);
    return ta.localeCompare(tb);
  });
}

/**
 * Beam search algorithm
 * 
 * @param seed - Initial hypotheses (usually one empty)
 * @param buckets - Groups of pattern candidates
 * @param tryAdd - Function to try adding candidate (checks conflicts)
 * @param scoreHyp - Function to score hypothesis
 * @param opts - Beam width and per-group K
 */
export function beamSearch(
  seed: Hypothesis[],
  buckets: GroupBucket[],
  tryAdd: TryAddFn,
  scoreHyp: ScoreFn,
  opts: BeamSearchOpts,
): Hypothesis[] {
  
  let beam = seed;
  
  for (const bucket of buckets) {
    // Take top-K from this group
    const topK = stableSort(
      bucket.candidates,
      c => c.finalScore,
      c => c.id || c.type
    ).slice(0, opts.perGroupK);
    
    const expanded: Hypothesis[] = [];
    
    for (const hyp of beam) {
      // Option 1: Don't take anything from this group (keep hypothesis as-is)
      expanded.push(hyp);
      
      // Option 2: Try adding each candidate
      for (const cand of topK) {
        const res = tryAdd(hyp, cand);
        if (!res.ok) continue;
        expanded.push(scoreHyp(res.hyp));
      }
    }
    
    // Keep top beamWidth
    beam = stableSort(expanded, h => h.score, h => h.id).slice(0, opts.beamWidth);
  }
  
  return beam;
}
