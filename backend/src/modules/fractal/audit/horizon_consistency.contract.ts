/**
 * HORIZON CONSISTENCY CONTRACT
 * 
 * L2/L3 Audit: Soft hierarchy for horizons
 * Ensures projections don't contradict across time horizons
 */

export interface HorizonConsistencyConfig {
  /** Minimum diff threshold before blending starts (%) */
  d0: number;
  /** Maximum diff threshold for full blend (%) */
  d1: number;
  /** Days to check prefix */
  prefixDays: number;
  /** Enable/disable adjustment */
  enabled: boolean;
}

export interface PrefixDiffResult {
  /** Mean absolute difference (%) */
  meanAbsDiff: number;
  /** Max difference (%) */
  maxDiff: number;
  /** Sign conflicts count */
  signConflicts: number;
  /** Total points compared */
  pointsCompared: number;
}

export interface BlendDiagnostics {
  /** Computed alpha (0=no blend, 1=full blend) */
  alpha: number;
  /** Original diff before adjustment */
  originalDiff: number;
  /** Diff after adjustment */
  adjustedDiff: number;
  /** Was adjustment applied? */
  adjusted: boolean;
  /** Timestamp */
  computedAt: string;
}

export interface HorizonConsistencyPack {
  /** Diff metrics for each pair */
  diff90in180: PrefixDiffResult | null;
  diff180in365: PrefixDiffResult | null;
  diff90in365: PrefixDiffResult | null;
  /** Blend diagnostics */
  blend180: BlendDiagnostics | null;
  blend365: BlendDiagnostics | null;
  /** Config used */
  config: HorizonConsistencyConfig;
}

export interface SeriesPoint {
  date: string;
  value: number;
  pct: number;
}

export const DEFAULT_CONSISTENCY_CONFIG: HorizonConsistencyConfig = {
  d0: 3.0,  // 3% - below this, no adjustment
  d1: 10.0, // 10% - above this, full blend
  prefixDays: 180,
  enabled: true,
};
