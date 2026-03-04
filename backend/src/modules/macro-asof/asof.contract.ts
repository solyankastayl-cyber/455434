/**
 * MACRO AS-OF CONTRACT — P3
 * 
 * Types for as-of / lagged reality queries.
 */

// ═══════════════════════════════════════════════════════════════
// AS-OF QUERY OPTIONS
// ═══════════════════════════════════════════════════════════════

export interface AsOfOptions {
  /**
   * The date to evaluate as of.
   * Only data released by this date will be used.
   * Default: today
   */
  asOf?: string;
  
  /**
   * Whether to apply publication lag.
   * If false, uses raw data (lookahead bias allowed).
   * Default: true
   */
  applyLag?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// DATA POINT WITH RELEASE INFO
// ═══════════════════════════════════════════════════════════════

export interface AsOfDataPoint {
  seriesId: string;
  valueDate: string;      // The period this value represents
  releaseDate: string;    // When it became available
  value: number;
  isLatest: boolean;      // Is this the latest available as of query date
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT WITH AS-OF METADATA
// ═══════════════════════════════════════════════════════════════

export interface AsOfMetadata {
  queryDate: string;        // The asOf date requested
  effectiveDate: string;    // Actual date data is from (after lag)
  lagApplied: boolean;
  seriesLags: Record<string, number>;  // Series ID -> lag days used
}

// ═══════════════════════════════════════════════════════════════
// SERIES LAG PROFILE
// ═══════════════════════════════════════════════════════════════

export interface SeriesLagProfile {
  seriesId: string;
  lagDays: number;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  source: 'FRED' | 'custom';
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════
// BACKTEST AS-OF CONFIG
// ═══════════════════════════════════════════════════════════════

export interface BacktestAsOfConfig {
  /**
   * Use as-of mode for honest backtesting
   */
  useAsOf: boolean;
  
  /**
   * Custom lag overrides (for sensitivity testing)
   */
  lagOverrides?: Record<string, number>;
  
  /**
   * Minimum lag to apply to all series
   */
  minLagDays?: number;
}
