/**
 * Phase D: Hypothesis Builder
 * 
 * The "brain" of TA Engine - builds competing market hypotheses
 * 
 * WORKFLOW:
 * 1. Group patterns by PatternGroup
 * 2. Run beam search with conflict checking
 * 3. Return top-N hypotheses
 * 
 * ARCHITECTURAL RULES:
 * - Max 1 pattern per group in a hypothesis
 * - Conflicts checked via Conflict Engine
 * - Scoring via Hypothesis Scoring
 */

import { beamSearch, BeamSearchOpts } from './beam_search.js';
import { Hypothesis, GroupBucket, PatternCandidate } from './hypothesis_types.js';
import { scoreHypothesis } from './hypothesis_scoring.js';
import { canAddWithoutConflict } from '../conflicts/conflict_engine.js';

export type ConflictResolver = (
  kept: PatternCandidate[], 
  cand: PatternCandidate
) => { ok: true } | { ok: false; reason: string };

/**
 * Default conflict resolver using Phase B Conflict Engine
 */
export function defaultConflictResolver(): ConflictResolver {
  return (kept, cand) => canAddWithoutConflict(kept, cand);
}

export type BuildHypothesesOpts = {
  beamWidth?: number;      // default 20
  perGroupK?: number;      // default 3
  topN?: number;           // default 20
  minComponents?: number;  // default 2
};

/**
 * Generate stable hypothesis ID
 */
function mkId(symbol: string, timeframe: string, comps: PatternCandidate[]): string {
  const ids = comps.map(c => c.id || c.type).sort().join('|');
  return `${symbol}:${timeframe}:${ids || 'empty'}`;
}

/**
 * Group patterns by their group field
 */
export function groupPatternsByGroup(patterns: PatternCandidate[]): GroupBucket[] {
  const groupMap = new Map<string, PatternCandidate[]>();
  
  for (const p of patterns) {
    const group = p.group || 'UNKNOWN';
    if (!groupMap.has(group)) {
      groupMap.set(group, []);
    }
    groupMap.get(group)!.push(p);
  }
  
  return Array.from(groupMap.entries()).map(([group, candidates]) => ({
    group,
    candidates
  }));
}

/**
 * Main hypothesis building function
 * 
 * @param symbol - Asset symbol (e.g., "BTCUSDT")
 * @param timeframe - Timeframe (e.g., "1D")
 * @param buckets - Pre-grouped pattern candidates
 * @param conflictResolver - Conflict checking function
 * @param opts - Builder options
 */
export function buildHypotheses(
  symbol: string,
  timeframe: string,
  buckets: GroupBucket[],
  conflictResolver: ConflictResolver,
  opts: BuildHypothesesOpts = {},
): Hypothesis[] {
  
  const beamWidth = opts.beamWidth ?? 20;
  const perGroupK = opts.perGroupK ?? 3;
  const topN = opts.topN ?? 20;
  const minComponents = opts.minComponents ?? 2;
  
  // Seed: one empty hypothesis
  const seed: Hypothesis[] = [{
    id: mkId(symbol, timeframe, []),
    symbol,
    timeframe,
    direction: 'NEUTRAL',
    components: [],
    score: 0,
    reasons: ['seed'],
  }];
  
  /**
   * Try adding a candidate to a hypothesis
   */
  const tryAdd = (hyp: Hypothesis, cand: PatternCandidate) => {
    // Rule: 1 pattern per group
    if (hyp.components.some(c => c.group === cand.group)) {
      return { ok: false as const, reason: `group_taken:${cand.group}` };
    }
    
    // Conflict check via Phase B
    const cr = conflictResolver(hyp.components, cand);
    if (!cr.ok) {
      return { ok: false as const, reason: cr.reason };
    }
    
    // Create new hypothesis with added component
    const next: Hypothesis = {
      ...hyp,
      components: [...hyp.components, cand],
      score: hyp.score, // temporary, will be recalculated
      reasons: [...hyp.reasons],
    };
    next.id = mkId(symbol, timeframe, next.components);
    
    return { ok: true as const, hyp: next };
  };
  
  /**
   * Score a hypothesis
   */
  const scoreFn = (hyp: Hypothesis): Hypothesis => {
    if (hyp.components.length === 0) return hyp;
    
    const sr = scoreHypothesis(hyp);
    return {
      ...hyp,
      score: sr.score,
      direction: sr.direction,
      reasons: sr.reasons,
    };
  };
  
  // Run beam search
  const beamOpts: BeamSearchOpts = { beamWidth, perGroupK };
  const out = beamSearch(seed, buckets, tryAdd, scoreFn, beamOpts);
  
  // Final filtering
  const filtered = out
    .filter(h => h.components.length >= minComponents)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
  
  return filtered;
}

/**
 * Convenience function: build hypotheses from flat pattern list
 */
export function buildHypothesesFromPatterns(
  symbol: string,
  timeframe: string,
  patterns: PatternCandidate[],
  opts: BuildHypothesesOpts = {},
): Hypothesis[] {
  const buckets = groupPatternsByGroup(patterns);
  return buildHypotheses(symbol, timeframe, buckets, defaultConflictResolver(), opts);
}

export * from './hypothesis_types.js';
export * from './hypothesis_scoring.js';
