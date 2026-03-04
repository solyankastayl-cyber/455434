/**
 * Coverage Service (P0 - Common Platform Layer)
 * 
 * Calculates data coverage percentage
 * coverage.pct = полнота данных, НЕ качество
 */

export interface CoverageResult {
  pct: number;
  note: string;
  details: {
    available: number;
    expected: number;
    sources: string[];
  };
}

/**
 * Calculate coverage from counts
 */
export function calculateCoverage(
  available: number,
  expected: number,
  sourceDescription: string
): CoverageResult {
  const pct = expected > 0 ? Math.round((available / expected) * 100) : 0;
  
  return {
    pct: Math.min(100, pct),
    note: `Based on ${available.toLocaleString()} ${sourceDescription}`,
    details: {
      available,
      expected,
      sources: [sourceDescription],
    },
  };
}

/**
 * Calculate coverage from multiple sources
 */
export function calculateMultiSourceCoverage(
  sources: { name: string; available: number; expected: number }[]
): CoverageResult {
  let totalAvailable = 0;
  let totalExpected = 0;
  const sourceNames: string[] = [];
  
  for (const source of sources) {
    totalAvailable += source.available;
    totalExpected += source.expected;
    if (source.available > 0) {
      sourceNames.push(`${source.available} ${source.name}`);
    }
  }
  
  const pct = totalExpected > 0 ? Math.round((totalAvailable / totalExpected) * 100) : 0;
  
  return {
    pct: Math.min(100, pct),
    note: `Based on ${sourceNames.join(', ')}`,
    details: {
      available: totalAvailable,
      expected: totalExpected,
      sources: sourceNames,
    },
  };
}

/**
 * Get coverage warning level
 */
export function getCoverageLevel(pct: number): 'high' | 'medium' | 'low' {
  if (pct >= 70) return 'high';
  if (pct >= 40) return 'medium';
  return 'low';
}

/**
 * Format coverage for display
 */
export function formatCoverage(coverage: CoverageResult): {
  pct: number;
  note: string;
  level: 'high' | 'medium' | 'low';
  warning?: string;
} {
  const level = getCoverageLevel(coverage.pct);
  
  return {
    pct: coverage.pct,
    note: coverage.note,
    level,
    warning: level === 'low' ? 'Limited data coverage may affect accuracy' : undefined,
  };
}
