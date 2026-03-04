/**
 * BLOCK 36.3 — Dynamic Similarity Floor + Match Dispersion
 * 
 * 36.3.1 Dynamic Floor:
 * Instead of fixed minSimilarity=0.40, we take top X% of candidates
 * but not below static floor. This handles regime volatility bias.
 * 
 * 36.3.2 Temporal Dispersion:
 * Limit matches per year to avoid single-regime dominance (e.g. 2017 bubble)
 */

export interface DynamicFloorConfig {
  enabled: boolean;
  staticFloor: number;      // minimum similarity (e.g. 0.40)
  dynamicQuantile: number;  // top X% (e.g. 0.15 = top 15%)
}

export interface DispersionConfig {
  enabled: boolean;
  maxPerYear: number;  // max matches from same year (e.g. 3)
}

export const DEFAULT_DYNAMIC_FLOOR: DynamicFloorConfig = {
  enabled: true,
  staticFloor: 0.40,
  dynamicQuantile: 0.15,
};

export const DEFAULT_DISPERSION: DispersionConfig = {
  enabled: true,
  maxPerYear: 3,
};

/**
 * Match candidate interface
 */
export interface MatchCandidate {
  endIdx: number;
  similarity: number;
  startTs: Date;
  endTs: Date;
  regimeKey?: string;
  [key: string]: any;
}

/**
 * 36.3.1 Apply Dynamic Similarity Floor
 * 
 * Takes top quantile of candidates but not below static floor.
 * This adapts to regime volatility:
 * - High-vol regime → naturally lower similarities → uses quantile
 * - Low-vol regime → higher similarities → uses static floor
 */
export function applyDynamicFloor<T extends { similarity: number }>(
  candidates: T[],
  config: DynamicFloorConfig = DEFAULT_DYNAMIC_FLOOR
): { filtered: T[]; stats: DynamicFloorStats } {
  
  const stats: DynamicFloorStats = {
    totalCandidates: candidates.length,
    staticFloor: config.staticFloor,
    quantileFloor: 0,
    effectiveFloor: config.staticFloor,
    passedCount: 0,
    usedDynamic: false,
  };

  if (!config.enabled || candidates.length === 0) {
    const filtered = candidates.filter(c => c.similarity >= config.staticFloor);
    stats.passedCount = filtered.length;
    return { filtered, stats };
  }

  // Sort similarities descending
  const sorted = candidates
    .map(c => c.similarity)
    .sort((a, b) => b - a);

  // Calculate quantile floor (top X%)
  const quantileIdx = Math.floor(sorted.length * config.dynamicQuantile);
  stats.quantileFloor = sorted[quantileIdx] ?? sorted[sorted.length - 1] ?? 0;

  // Effective floor = max(static, quantile)
  stats.effectiveFloor = Math.max(config.staticFloor, stats.quantileFloor);
  stats.usedDynamic = stats.quantileFloor > config.staticFloor;

  // Filter by effective floor
  const filtered = candidates.filter(c => c.similarity >= stats.effectiveFloor);
  stats.passedCount = filtered.length;

  return { filtered, stats };
}

export interface DynamicFloorStats {
  totalCandidates: number;
  staticFloor: number;
  quantileFloor: number;
  effectiveFloor: number;
  passedCount: number;
  usedDynamic: boolean;
}

/**
 * 36.3.2 Enforce Temporal Dispersion (Anti-Clustering)
 * 
 * Limits matches per year to avoid single-regime dominance.
 * If top-15 matches are all from 2017 bubble, that's not 15 examples,
 * it's 1 bubble repeated.
 */
export function enforceTemporalDispersion<T extends { endTs: Date | number | string }>(
  matches: T[],
  config: DispersionConfig = DEFAULT_DISPERSION
): { dispersed: T[]; stats: DispersionStats } {
  
  const stats: DispersionStats = {
    inputCount: matches.length,
    outputCount: 0,
    yearDistribution: {},
    droppedByYear: {},
  };

  if (!config.enabled) {
    stats.outputCount = matches.length;
    return { dispersed: matches, stats };
  }

  const bucket: Record<number, number> = {};
  const dropped: Record<number, number> = {};
  const out: T[] = [];

  for (const m of matches) {
    const ts = m.endTs instanceof Date 
      ? m.endTs 
      : new Date(m.endTs);
    const year = ts.getUTCFullYear();
    
    bucket[year] = bucket[year] ?? 0;
    dropped[year] = dropped[year] ?? 0;

    if (bucket[year] < config.maxPerYear) {
      out.push(m);
      bucket[year]++;
    } else {
      dropped[year]++;
    }
  }

  stats.outputCount = out.length;
  stats.yearDistribution = { ...bucket };
  stats.droppedByYear = dropped;

  return { dispersed: out, stats };
}

export interface DispersionStats {
  inputCount: number;
  outputCount: number;
  yearDistribution: Record<number, number>;
  droppedByYear: Record<number, number>;
}

/**
 * Combined filter: Dynamic Floor + Dispersion
 */
export function applyMatchFilters<T extends MatchCandidate>(
  candidates: T[],
  floorConfig: DynamicFloorConfig = DEFAULT_DYNAMIC_FLOOR,
  dispersionConfig: DispersionConfig = DEFAULT_DISPERSION
): {
  filtered: T[];
  floorStats: DynamicFloorStats;
  dispersionStats: DispersionStats;
} {
  // Step 1: Apply dynamic floor
  const { filtered: afterFloor, stats: floorStats } = applyDynamicFloor(candidates, floorConfig);
  
  // Step 2: Sort by similarity (should already be sorted, but ensure)
  afterFloor.sort((a, b) => b.similarity - a.similarity);
  
  // Step 3: Apply dispersion
  const { dispersed, stats: dispersionStats } = enforceTemporalDispersion(afterFloor, dispersionConfig);
  
  return {
    filtered: dispersed,
    floorStats,
    dispersionStats,
  };
}

/**
 * Diagnostics helper: analyze match distribution
 */
export function analyzeMatchDistribution<T extends { endTs: Date | number | string; similarity: number }>(
  matches: T[]
): {
  byYear: Record<number, { count: number; avgSimilarity: number }>;
  concentrationScore: number;  // 0 = perfect spread, 1 = all in one year
  dominantYear: number | null;
  dominantYearPct: number;
} {
  const byYear: Record<number, { count: number; totalSim: number }> = {};
  
  for (const m of matches) {
    const ts = m.endTs instanceof Date ? m.endTs : new Date(m.endTs);
    const year = ts.getUTCFullYear();
    
    if (!byYear[year]) {
      byYear[year] = { count: 0, totalSim: 0 };
    }
    byYear[year].count++;
    byYear[year].totalSim += m.similarity;
  }

  // Calculate averages and find dominant year
  const result: Record<number, { count: number; avgSimilarity: number }> = {};
  let maxCount = 0;
  let dominantYear: number | null = null;
  
  for (const [yearStr, data] of Object.entries(byYear)) {
    const year = parseInt(yearStr);
    result[year] = {
      count: data.count,
      avgSimilarity: data.totalSim / data.count,
    };
    if (data.count > maxCount) {
      maxCount = data.count;
      dominantYear = year;
    }
  }

  const totalMatches = matches.length;
  const dominantYearPct = totalMatches > 0 ? maxCount / totalMatches : 0;
  
  // Concentration score: Herfindahl index normalized
  // 0 = perfect spread, 1 = all in one year
  let hhi = 0;
  for (const data of Object.values(byYear)) {
    const share = data.count / totalMatches;
    hhi += share * share;
  }
  // Normalize: min HHI = 1/n, max = 1
  const years = Object.keys(byYear).length;
  const concentrationScore = years > 1 
    ? (hhi - 1/years) / (1 - 1/years)
    : 1;

  return {
    byYear: result,
    concentrationScore: Math.round(concentrationScore * 1000) / 1000,
    dominantYear,
    dominantYearPct: Math.round(dominantYearPct * 1000) / 1000,
  };
}
