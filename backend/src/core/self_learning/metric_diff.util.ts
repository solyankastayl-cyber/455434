/**
 * Metric Diff Utility
 * 
 * ETAP 5.4: Calculate delta between candidate and baseline metrics.
 */

export type MetricsDiff = Record<string, number>;

/**
 * Calculate metric differences
 * 
 * Returns: candidate - baseline for each metric
 * Positive = candidate is better (for metrics where higher is better)
 */
export function diffMetrics(
  candidate: Record<string, number>,
  baseline: Record<string, number>
): MetricsDiff {
  const diff: MetricsDiff = {};
  
  // Combine all keys from both
  const allKeys = new Set([...Object.keys(candidate), ...Object.keys(baseline)]);
  
  for (const key of allKeys) {
    const candidateVal = candidate[key] ?? 0;
    const baselineVal = baseline[key] ?? 0;
    diff[key] = candidateVal - baselineVal;
  }
  
  return diff;
}

/**
 * Calculate percentage change
 */
export function percentChange(
  candidate: number,
  baseline: number
): number {
  if (baseline === 0) {
    return candidate > 0 ? Infinity : 0;
  }
  return ((candidate - baseline) / Math.abs(baseline)) * 100;
}

/**
 * Calculate all percentage changes
 */
export function diffMetricsPercent(
  candidate: Record<string, number>,
  baseline: Record<string, number>
): MetricsDiff {
  const diff: MetricsDiff = {};
  
  const allKeys = new Set([...Object.keys(candidate), ...Object.keys(baseline)]);
  
  for (const key of allKeys) {
    const candidateVal = candidate[key] ?? 0;
    const baselineVal = baseline[key] ?? 0;
    diff[key] = percentChange(candidateVal, baselineVal);
  }
  
  return diff;
}

/**
 * Check if metric improvement meets threshold
 */
export function meetsThreshold(
  diff: number,
  threshold: number,
  higherIsBetter: boolean = true
): boolean {
  if (higherIsBetter) {
    return diff >= threshold;
  }
  return diff <= -threshold;
}
