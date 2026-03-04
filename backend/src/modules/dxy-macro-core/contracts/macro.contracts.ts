/**
 * MACRO CONTRACTS — B1
 * 
 * Data structures for macro series, context, and score.
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import { MacroFrequency, MacroRole, MacroTransform } from '../data/macro_sources.registry.js';

// ═══════════════════════════════════════════════════════════════
// MACRO POINT — Individual data point
// ═══════════════════════════════════════════════════════════════

export interface MacroPoint {
  ts: Date;
  value: number;
  source: "FRED" | "MANUAL" | "DERIVED";
  seriesId: string;
}

// ═══════════════════════════════════════════════════════════════
// MACRO SERIES META — Series metadata
// ═══════════════════════════════════════════════════════════════

export interface MacroSeriesMeta {
  seriesId: string;
  displayName: string;
  frequency: MacroFrequency;
  units: string;
  role: MacroRole;
  source: string;
  updatedAt: Date;
  pointCount: number;
  firstDate: string;
  lastDate: string;
  coverageYears: number;
}

// ═══════════════════════════════════════════════════════════════
// MACRO TREND — Trend classification
// ═══════════════════════════════════════════════════════════════

export type MacroTrend = "UP" | "DOWN" | "FLAT";

// ═══════════════════════════════════════════════════════════════
// MACRO REGIME — Regime classification by role
// ═══════════════════════════════════════════════════════════════

// Rates regime
export type RatesRegime = "TIGHTENING" | "EASING" | "PAUSE";

// Inflation regime
export type InflationRegime = "COOLING" | "STABLE" | "REHEATING";

// Labor regime
export type LaborRegime = "LOW" | "NORMAL" | "STRESS";

// Curve regime
export type CurveRegime = "STEEP" | "NORMAL" | "INVERTED";

// Liquidity regime
export type LiquidityRegime = "CONTRACTION" | "STABLE" | "EXPANSION";

// Generic regime union
export type MacroRegime = 
  | RatesRegime 
  | InflationRegime 
  | LaborRegime 
  | CurveRegime 
  | LiquidityRegime
  | "UNKNOWN";

// ═══════════════════════════════════════════════════════════════
// MACRO CONTEXT — Context for a single series
// ═══════════════════════════════════════════════════════════════

export interface MacroContext {
  seriesId: string;
  displayName: string;
  role: MacroRole;
  
  // Current state
  current: {
    value: number;
    date: string;
    transform: MacroTransform;  // what "value" represents
  };
  
  // Deltas (change over time)
  deltas: {
    delta1m?: number;   // 1 month change
    delta3m?: number;   // 3 month change
    delta12m?: number;  // 12 month change (YoY)
  };
  
  // Statistical context
  stats: {
    mean: number;       // rolling mean
    stdDev: number;     // rolling std dev
    zScore: number;     // current z-score
    percentile: number; // current percentile (0-100)
  };
  
  // Regime and pressure
  trend: MacroTrend;
  regime: MacroRegime;
  pressure: number;     // -1..+1 (+ = dollar strength / risk-off)
  
  // Quality
  quality: {
    freshness: "FRESH" | "STALE" | "OLD";  // days since last update
    coverage: number;   // years of data
    gaps: number;       // number of gaps detected
  };
  
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// MACRO SCORE COMPONENT — Individual series contribution
// ═══════════════════════════════════════════════════════════════

export interface MacroScoreComponent {
  seriesId: string;
  displayName: string;
  role: MacroRole;
  weight: number;
  rawPressure: number;    // -1..+1
  normalizedPressure: number;  // weighted contribution
  regime: MacroRegime;
}

// ═══════════════════════════════════════════════════════════════
// MACRO SCORE — Composite macro score
// ═══════════════════════════════════════════════════════════════

export type MacroConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface MacroScore {
  // Scores
  score01: number;        // 0..1 (0 = max risk-on / dollar weakness)
  scoreSigned: number;    // -1..+1 (+ = dollar strength / risk-off)
  
  // Confidence
  confidence: MacroConfidence;
  confidenceReasons: string[];
  
  // Quality
  quality: {
    seriesCount: number;
    freshCount: number;
    staleCount: number;
    avgCoverage: number;
    qualityPenalty: number;  // 0..1 reduction factor
  };
  
  // Components
  components: MacroScoreComponent[];
  
  // Summary
  summary: {
    dominantRegime: string;
    dominantRole: MacroRole;
    keyDrivers: string[];
  };
  
  // Meta
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// INGEST RESULT
// ═══════════════════════════════════════════════════════════════

export interface MacroIngestResult {
  seriesId: string;
  ok: boolean;
  pointsWritten: number;
  pointsSkipped: number;
  firstDate?: string;
  lastDate?: string;
  error?: string;
}

export interface MacroBulkIngestResult {
  ok: boolean;
  totalSeries: number;
  successCount: number;
  failCount: number;
  results: MacroIngestResult[];
  processingTimeMs: number;
}
