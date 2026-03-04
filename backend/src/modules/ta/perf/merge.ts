/**
 * Phase U: Performance Engine - Deterministic Merge & Sort
 * 
 * Ensures parallel execution produces deterministic results.
 * Critical for Phase S3 compliance.
 */

import { CandidatePattern } from '../domain/types.js';

/**
 * Stable sort comparator for patterns
 * 
 * Ensures same input always produces same output order:
 * 1. Sort by type (alphabetical)
 * 2. Sort by startIndex (ascending)
 * 3. Sort by endIndex (ascending)
 * 4. Sort by score (descending)
 * 5. Sort by id (alphabetical) - final tiebreaker
 */
export function stablePatternSort(a: CandidatePattern, b: CandidatePattern): number {
  // 1. Type
  if (a.type !== b.type) {
    return a.type.localeCompare(b.type);
  }
  
  // 2. Start index
  if (a.startIndex !== b.startIndex) {
    return a.startIndex - b.startIndex;
  }
  
  // 3. End index
  if (a.endIndex !== b.endIndex) {
    return a.endIndex - b.endIndex;
  }
  
  // 4. Score (descending)
  const scoreA = a.metrics?.totalScore ?? 0;
  const scoreB = b.metrics?.totalScore ?? 0;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  
  // 5. ID (final tiebreaker for determinism)
  return a.id.localeCompare(b.id);
}

/**
 * Merge and deduplicate patterns from multiple sources
 */
export function mergePatterns(
  patternArrays: CandidatePattern[][],
  options: { 
    dedup?: boolean;
    maxPatterns?: number;
    sortFirst?: boolean;
  } = {}
): CandidatePattern[] {
  const { dedup = true, maxPatterns, sortFirst = true } = options;
  
  // Flatten
  let patterns = patternArrays.flat();
  
  // Sort first (important for deterministic dedup)
  if (sortFirst) {
    patterns.sort(stablePatternSort);
  }
  
  // Deduplicate
  if (dedup) {
    patterns = deduplicatePatterns(patterns);
  }
  
  // Limit
  if (maxPatterns && patterns.length > maxPatterns) {
    patterns = patterns.slice(0, maxPatterns);
  }
  
  return patterns;
}

/**
 * Remove duplicate/overlapping patterns
 * 
 * Two patterns are considered duplicates if:
 * - Same type
 * - Overlapping index range (>80% overlap)
 * - Similar score (within 10%)
 */
export function deduplicatePatterns(patterns: CandidatePattern[]): CandidatePattern[] {
  if (patterns.length === 0) return [];
  
  const result: CandidatePattern[] = [];
  const seen = new Set<string>();
  
  for (const pattern of patterns) {
    // Create dedup key
    const key = createDedupKey(pattern);
    
    if (!seen.has(key)) {
      // Check for overlapping patterns of same type
      const hasOverlap = result.some(existing => 
        existing.type === pattern.type && 
        calculateOverlap(existing, pattern) > 0.8
      );
      
      if (!hasOverlap) {
        result.push(pattern);
        seen.add(key);
      }
    }
  }
  
  return result;
}

/**
 * Create deterministic dedup key
 */
function createDedupKey(pattern: CandidatePattern): string {
  const startBucket = Math.floor(pattern.startIndex / 5) * 5;
  const endBucket = Math.floor(pattern.endIndex / 5) * 5;
  const scoreBucket = Math.floor((pattern.metrics?.totalScore ?? 0) * 10);
  
  return `${pattern.type}:${startBucket}:${endBucket}:${scoreBucket}`;
}

/**
 * Calculate overlap ratio between two patterns
 */
function calculateOverlap(a: CandidatePattern, b: CandidatePattern): number {
  const aStart = a.startIndex;
  const aEnd = a.endIndex;
  const bStart = b.startIndex;
  const bEnd = b.endIndex;
  
  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);
  
  if (overlapStart >= overlapEnd) return 0;
  
  const overlapLength = overlapEnd - overlapStart;
  const aLength = aEnd - aStart || 1;
  const bLength = bEnd - bStart || 1;
  
  return overlapLength / Math.min(aLength, bLength);
}

/**
 * Group patterns by type for analysis
 */
export function groupByType(patterns: CandidatePattern[]): Map<string, CandidatePattern[]> {
  const groups = new Map<string, CandidatePattern[]>();
  
  for (const pattern of patterns) {
    const existing = groups.get(pattern.type) || [];
    existing.push(pattern);
    groups.set(pattern.type, existing);
  }
  
  return groups;
}

/**
 * Get top N patterns by score
 */
export function topN(patterns: CandidatePattern[], n: number): CandidatePattern[] {
  // Sort by score descending (already stable)
  const sorted = [...patterns].sort((a, b) => {
    const scoreA = a.metrics?.totalScore ?? 0;
    const scoreB = b.metrics?.totalScore ?? 0;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return stablePatternSort(a, b);
  });
  
  return sorted.slice(0, n);
}
