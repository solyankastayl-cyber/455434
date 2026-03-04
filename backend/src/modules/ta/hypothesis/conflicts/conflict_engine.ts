/**
 * Phase B: Conflict Engine - Resolves mutually exclusive patterns
 * 
 * ARCHITECTURAL PRINCIPLES:
 * 1. Detectors do NOT know about each other
 * 2. Conflict resolution happens AFTER detection, BEFORE Confluence
 * 3. Higher score wins conflicts
 * 4. Uses exclusivityKey from registry for same-category conflicts
 * 
 * Pipeline position:
 * Detectors → [Conflict Engine] → Confluence → Hypothesis Builder → Ranker
 */

import { hasHardConflict, getSoftConflictMultiplier } from './conflicts.js';

export interface PatternCandidate {
  id: string;
  type: string;
  group: string;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL' | 'BOTH';
  score: number;
  finalScore?: number;
  exclusivityKey: string;
  priority?: number;
  metrics?: Record<string, any>;
}

export interface ConflictResolution {
  rejected: string;
  winner: string;
  reason: 'hard_conflict' | 'exclusivity_key' | 'soft_conflict';
  detail?: string;
}

export interface ConflictEngineResult {
  kept: PatternCandidate[];
  dropped: PatternCandidate[];
  conflicts: ConflictResolution[];
  stats: {
    input: number;
    output: number;
    hardConflicts: number;
    exclusivityConflicts: number;
    softConflicts: number;
  };
}

/**
 * Main conflict resolution function
 * 
 * Algorithm:
 * 1. Sort patterns by score (highest first)
 * 2. Iterate top-down
 * 3. For each pattern, check against already-kept patterns:
 *    - Hard conflict → reject
 *    - ExclusivityKey match → reject
 *    - Soft conflict → apply multiplier (but keep)
 * 4. Return kept, dropped, and conflict log
 */
export function resolveConflicts(patterns: PatternCandidate[]): ConflictEngineResult {
  const kept: PatternCandidate[] = [];
  const dropped: PatternCandidate[] = [];
  const conflicts: ConflictResolution[] = [];
  
  let hardConflicts = 0;
  let exclusivityConflicts = 0;
  let softConflicts = 0;
  
  // Sort by score descending (highest score first = priority)
  const sorted = [...patterns].sort((a, b) => {
    const scoreA = a.finalScore ?? a.score;
    const scoreB = b.finalScore ?? b.score;
    if (scoreB !== scoreA) return scoreB - scoreA;
    // Tie-breaker: priority from registry
    return (b.priority ?? 50) - (a.priority ?? 50);
  });
  
  for (const pattern of sorted) {
    let rejected = false;
    let softMultiplier = 1.0;
    
    for (const keeper of kept) {
      // 1. Check hard conflict
      if (hasHardConflict(pattern.type, keeper.type)) {
        rejected = true;
        hardConflicts++;
        conflicts.push({
          rejected: pattern.type,
          winner: keeper.type,
          reason: 'hard_conflict',
          detail: `${pattern.type} conflicts with ${keeper.type}`
        });
        break;
      }
      
      // 2. Check exclusivity key
      if (pattern.exclusivityKey && 
          pattern.exclusivityKey !== 'none' && 
          pattern.exclusivityKey === keeper.exclusivityKey) {
        rejected = true;
        exclusivityConflicts++;
        conflicts.push({
          rejected: pattern.type,
          winner: keeper.type,
          reason: 'exclusivity_key',
          detail: `Same exclusivityKey: ${pattern.exclusivityKey}`
        });
        break;
      }
      
      // 3. Check soft conflict (accumulate multiplier)
      const mult = getSoftConflictMultiplier(pattern.type, keeper.type);
      if (mult < 1.0) {
        softMultiplier *= mult;
        softConflicts++;
        conflicts.push({
          rejected: pattern.type,
          winner: keeper.type,
          reason: 'soft_conflict',
          detail: `Soft conflict: score *= ${mult}`
        });
      }
    }
    
    if (!rejected) {
      // Apply soft conflict multiplier to score
      const adjustedPattern = { ...pattern };
      if (softMultiplier < 1.0) {
        adjustedPattern.finalScore = (pattern.finalScore ?? pattern.score) * softMultiplier;
      }
      kept.push(adjustedPattern);
    } else {
      dropped.push(pattern);
    }
  }
  
  return {
    kept,
    dropped,
    conflicts,
    stats: {
      input: patterns.length,
      output: kept.length,
      hardConflicts,
      exclusivityConflicts,
      softConflicts
    }
  };
}

/**
 * Quick check if a candidate can be added to existing set
 * Used by Hypothesis Builder for early pruning
 */
export function canAddWithoutConflict(
  existing: PatternCandidate[], 
  candidate: PatternCandidate
): { ok: true } | { ok: false; reason: string } {
  
  for (const keeper of existing) {
    // Hard conflict
    if (hasHardConflict(candidate.type, keeper.type)) {
      return { ok: false, reason: `hard_conflict:${keeper.type}` };
    }
    
    // Exclusivity key
    if (candidate.exclusivityKey && 
        candidate.exclusivityKey !== 'none' && 
        candidate.exclusivityKey === keeper.exclusivityKey) {
      return { ok: false, reason: `exclusivity:${candidate.exclusivityKey}` };
    }
  }
  
  return { ok: true };
}

export { hasHardConflict, getSoftConflictMultiplier };
