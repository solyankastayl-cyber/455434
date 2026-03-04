/**
 * Phase R9: Dedup Utilities
 * Detect overlapping and duplicate patterns
 */

/**
 * Calculate overlap ratio between two index ranges
 */
export function overlap(
  a: { s: number; e: number },
  b: { s: number; e: number }
): number {
  const overlapStart = Math.max(a.s, b.s);
  const overlapEnd = Math.min(a.e, b.e);
  const overlapLen = Math.max(0, overlapEnd - overlapStart);
  
  const maxLen = Math.max(1, Math.max(a.e - a.s, b.e - b.s));
  return overlapLen / maxLen;
}

/**
 * Check if two prices are within tolerance
 */
export function near(a: number, b: number, tolPct = 0.003): boolean {
  return Math.abs(a - b) / Math.max(1e-9, b) <= tolPct;
}

/**
 * Check if two patterns are effectively duplicates
 */
export function isDuplicate(
  p1: any,
  p2: any,
  overlapThreshold = 0.6,
  priceTol = 0.003
): boolean {
  // Must have same direction
  if (p1.direction !== p2.direction) return false;
  
  // Check index overlap
  const ov = overlap(
    { s: p1.startIndex, e: p1.endIndex },
    { s: p2.startIndex, e: p2.endIndex }
  );
  
  if (ov < overlapThreshold) return false;
  
  // Check price level proximity
  const lvl1 = p1.priceLevels?.[0];
  const lvl2 = p2.priceLevels?.[0];
  
  if (lvl1 != null && lvl2 != null) {
    return near(lvl1, lvl2, priceTol);
  }
  
  // If no price levels, rely on overlap alone
  return true;
}

/**
 * Check if patterns have same exclusivity key (mutually exclusive)
 */
export function sameExclusivity(
  p1: any,
  p2: any,
  registry: Record<string, { exclusivityKey?: string }>
): boolean {
  const key1 = registry[p1.type]?.exclusivityKey;
  const key2 = registry[p2.type]?.exclusivityKey;
  
  return key1 != null && key1 === key2;
}
