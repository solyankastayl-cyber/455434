/**
 * HORIZON CONSISTENCY SERVICE
 * 
 * L2/L3 Audit Implementation
 * 
 * Purpose: Ensure projections across different horizons
 * don't contradict each other (soft hierarchy, not hard constraint)
 * 
 * Formula:
 *   α = clamp((d - d0) / (d1 - d0), 0, 1)
 *   A' = (1 - α) * A + α * B
 * 
 * Where:
 *   A = prefix of longer horizon
 *   B = shorter horizon projection
 *   d = meanAbsDiff(A, B)
 */

import type {
  HorizonConsistencyConfig,
  PrefixDiffResult,
  BlendDiagnostics,
  HorizonConsistencyPack,
  SeriesPoint,
  DEFAULT_CONSISTENCY_CONFIG,
} from './horizon_consistency.contract.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// ═══════════════════════════════════════════════════════════════
// PREFIX DIFF CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Compute difference between prefix of long series and short series
 * 
 * @param longSeries - Longer projection (e.g., 365d)
 * @param shortSeries - Shorter projection (e.g., 180d)
 * @param prefixDays - Days to compare
 */
export function computePrefixDiff(
  longSeries: SeriesPoint[],
  shortSeries: SeriesPoint[],
  prefixDays: number
): PrefixDiffResult {
  // Get prefix from long series
  const prefix = longSeries.slice(0, prefixDays);
  const short = shortSeries.slice(0, prefixDays);
  
  const pointsCompared = Math.min(prefix.length, short.length);
  
  if (pointsCompared === 0) {
    return {
      meanAbsDiff: 0,
      maxDiff: 0,
      signConflicts: 0,
      pointsCompared: 0,
    };
  }
  
  let totalAbsDiff = 0;
  let maxDiff = 0;
  let signConflicts = 0;
  
  for (let i = 0; i < pointsCompared; i++) {
    const pctLong = prefix[i]?.pct || 0;
    const pctShort = short[i]?.pct || 0;
    
    const diff = Math.abs(pctLong - pctShort);
    totalAbsDiff += diff;
    
    if (diff > maxDiff) {
      maxDiff = diff;
    }
    
    // Sign conflict: one positive, one negative, both significant
    if (Math.abs(pctLong) > 1 && Math.abs(pctShort) > 1) {
      if ((pctLong > 0 && pctShort < 0) || (pctLong < 0 && pctShort > 0)) {
        signConflicts++;
      }
    }
  }
  
  return {
    meanAbsDiff: round4(totalAbsDiff / pointsCompared),
    maxDiff: round4(maxDiff),
    signConflicts,
    pointsCompared,
  };
}

// ═══════════════════════════════════════════════════════════════
// SOFT BLEND
// ═══════════════════════════════════════════════════════════════

/**
 * Apply soft blend to reduce contradiction between horizons
 * 
 * @param longSeries - Longer projection to adjust
 * @param shortSeries - Shorter projection (reference)
 * @param config - Consistency config
 */
export function softBlendPrefix(
  longSeries: SeriesPoint[],
  shortSeries: SeriesPoint[],
  config: HorizonConsistencyConfig
): { adjusted: SeriesPoint[]; diagnostics: BlendDiagnostics } {
  const { d0, d1, prefixDays, enabled } = config;
  
  // Calculate diff
  const diffResult = computePrefixDiff(longSeries, shortSeries, prefixDays);
  const d = diffResult.meanAbsDiff;
  
  // If disabled or diff below threshold, return original
  if (!enabled || d <= d0) {
    return {
      adjusted: longSeries,
      diagnostics: {
        alpha: 0,
        originalDiff: d,
        adjustedDiff: d,
        adjusted: false,
        computedAt: new Date().toISOString(),
      },
    };
  }
  
  // Calculate alpha
  const alpha = clamp((d - d0) / (d1 - d0), 0, 1);
  
  // Blend prefix
  const adjustedPrefix: SeriesPoint[] = [];
  const blendDays = Math.min(prefixDays, longSeries.length, shortSeries.length);
  
  for (let i = 0; i < blendDays; i++) {
    const longPoint = longSeries[i];
    const shortPoint = shortSeries[i];
    
    if (!longPoint || !shortPoint) continue;
    
    // Blend values
    const blendedPct = (1 - alpha) * longPoint.pct + alpha * shortPoint.pct;
    const blendedValue = (1 - alpha) * longPoint.value + alpha * shortPoint.value;
    
    adjustedPrefix.push({
      date: longPoint.date,
      value: round4(blendedValue),
      pct: round4(blendedPct),
    });
  }
  
  // Concatenate adjusted prefix with tail of long series
  const tail = longSeries.slice(blendDays);
  const adjusted = [...adjustedPrefix, ...tail];
  
  // Calculate new diff
  const newDiffResult = computePrefixDiff(adjusted, shortSeries, prefixDays);
  
  return {
    adjusted,
    diagnostics: {
      alpha: round4(alpha),
      originalDiff: d,
      adjustedDiff: newDiffResult.meanAbsDiff,
      adjusted: true,
      computedAt: new Date().toISOString(),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// HIERARCHY PACK PROCESSOR
// ═══════════════════════════════════════════════════════════════

export interface HorizonPack {
  p30?: SeriesPoint[];
  p90?: SeriesPoint[];
  p180?: SeriesPoint[];
  p365?: SeriesPoint[];
}

export interface AdjustedHorizonPack extends HorizonPack {
  diagnostics: HorizonConsistencyPack;
}

/**
 * Apply hierarchy consistency to all horizons
 * 
 * @param pack - Original horizon projections
 * @param config - Consistency config
 */
export function applyHierarchyPack(
  pack: HorizonPack,
  config: HorizonConsistencyConfig = {
    d0: 3.0,
    d1: 10.0,
    prefixDays: 180,
    enabled: true,
  }
): AdjustedHorizonPack {
  const { p30, p90, p180, p365 } = pack;
  
  let adjusted180 = p180;
  let adjusted365 = p365;
  let blend180Diag: BlendDiagnostics | null = null;
  let blend365Diag: BlendDiagnostics | null = null;
  
  // Diff calculations
  let diff90in180: PrefixDiffResult | null = null;
  let diff180in365: PrefixDiffResult | null = null;
  let diff90in365: PrefixDiffResult | null = null;
  
  // Calculate diffs
  if (p90 && p180) {
    diff90in180 = computePrefixDiff(p180, p90, 90);
  }
  
  if (p180 && p365) {
    diff180in365 = computePrefixDiff(p365, p180, 180);
  }
  
  if (p90 && p365) {
    diff90in365 = computePrefixDiff(p365, p90, 90);
  }
  
  // Apply soft blend for 365 based on 180
  if (p180 && p365 && config.enabled) {
    const result = softBlendPrefix(p365, p180, config);
    adjusted365 = result.adjusted;
    blend365Diag = result.diagnostics;
  }
  
  // Apply soft blend for 180 based on 90
  if (p90 && p180 && config.enabled) {
    const config90 = { ...config, prefixDays: 90 };
    const result = softBlendPrefix(p180, p90, config90);
    adjusted180 = result.adjusted;
    blend180Diag = result.diagnostics;
  }
  
  return {
    p30,
    p90,
    p180: adjusted180,
    p365: adjusted365,
    diagnostics: {
      diff90in180,
      diff180in365,
      diff90in365,
      blend180: blend180Diag,
      blend365: blend365Diag,
      config,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  computePrefixDiff,
  softBlendPrefix,
  applyHierarchyPack,
};
