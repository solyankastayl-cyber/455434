/**
 * Phase S3.2: Stable Ordering
 * Deterministic sorting for patterns before clustering/dedup
 */

export interface Sortable {
  type: string;
  startIndex: number;
  endIndex: number;
  confidence?: number;
  score?: number;
  direction?: string;
}

/**
 * Stable sort comparator for patterns
 * Order: type ASC, startIndex ASC, endIndex ASC, score DESC
 */
export function stablePatternComparator(a: Sortable, b: Sortable): number {
  // 1. By type (alphabetical)
  if (a.type < b.type) return -1;
  if (a.type > b.type) return 1;
  
  // 2. By startIndex
  if (a.startIndex !== b.startIndex) {
    return a.startIndex - b.startIndex;
  }
  
  // 3. By endIndex
  if (a.endIndex !== b.endIndex) {
    return a.endIndex - b.endIndex;
  }
  
  // 4. By score (descending)
  const scoreA = a.confidence ?? a.score ?? 0;
  const scoreB = b.confidence ?? b.score ?? 0;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  
  // 5. By direction
  const dirA = a.direction ?? '';
  const dirB = b.direction ?? '';
  if (dirA < dirB) return -1;
  if (dirA > dirB) return 1;
  
  return 0;
}

/**
 * Stable sort patterns array
 */
export function stableSortPatterns<T extends Sortable>(patterns: T[]): T[] {
  return [...patterns].sort(stablePatternComparator);
}

/**
 * Create deterministic ID from pattern
 */
export function deterministicPatternId(pattern: Sortable): string {
  return `${pattern.type}:${pattern.startIndex}:${pattern.endIndex}:${pattern.direction || 'N'}`;
}

/**
 * Stable group patterns by type
 */
export function groupByType<T extends Sortable>(patterns: T[]): Map<string, T[]> {
  const sorted = stableSortPatterns(patterns);
  const groups = new Map<string, T[]>();
  
  for (const p of sorted) {
    const existing = groups.get(p.type) || [];
    existing.push(p);
    groups.set(p.type, existing);
  }
  
  return groups;
}

/**
 * Stable dedup with deterministic selection
 * When duplicates exist, selects based on stable ordering (highest score first)
 */
export function stableDedup<T extends Sortable>(patterns: T[]): T[] {
  const sorted = stableSortPatterns(patterns);
  const seen = new Set<string>();
  const result: T[] = [];
  
  for (const p of sorted) {
    const id = deterministicPatternId(p);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(p);
    }
  }
  
  return result;
}
