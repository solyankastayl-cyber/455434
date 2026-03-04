/**
 * SPX DRIFT — Types
 * 
 * BLOCK B6.3 — Drift Intelligence (LIVE vs Vintage)
 */

export type DriftWindow = '30d' | '60d' | '90d' | '180d' | '365d' | 'all';
export type SpxCohort = 'LIVE' | 'V2020' | 'V1950' | 'ALL_VINTAGE';
export type DriftSeverity = 'OK' | 'WATCH' | 'WARN' | 'CRITICAL';
export type DriftConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PerfMetrics {
  samples: number;
  hitRate: number;      // %
  expectancy: number;   // decimal
  sharpe: number;
  maxDD: number;        // decimal (e.g., 0.12 => -12%)
}

export interface DriftDelta {
  hitRate: number;      // pp delta
  expectancy: number;
  sharpe: number;
  maxDD: number;
}

export interface DriftIntelReport {
  symbol: 'SPX';
  window: DriftWindow;
  compare: SpxCohort;
  asOfDate: string;
  live: PerfMetrics;
  vintage: PerfMetrics;
  delta: DriftDelta;
  severity: DriftSeverity;
  confidence: DriftConfidence;
  notes: string[];
}
