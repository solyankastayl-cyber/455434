/**
 * BLOCK 70.2 — FocusPack Types (Desk-Grade Terminal Contract)
 * 
 * This is the single source of truth for focus-driven terminal data.
 * Frontend should ONLY use focusPack for visualization.
 */

import type { HorizonKey } from '../config/horizon.config.js';

// ═══════════════════════════════════════════════════════════════
// FOCUS PACK CONTRACT
// ═══════════════════════════════════════════════════════════════

export interface FocusPackMeta {
  symbol: string;
  focus: HorizonKey;
  horizon?: HorizonKey;  // U3: Explicit horizon field for frontend tracking
  windowLen: number;
  aftermathDays: number;
  topK: number;
  tier: 'TIMING' | 'TACTICAL' | 'STRUCTURE';
  asOf: string;
  configSource?: 'mongo' | 'static'; // P0: Track runtime config source
  // P5.1: Health-based confidence adjustment
  confidence?: {
    base: number;       // Original confidence
    modifier: number;   // 1.0 | 0.6 | 0.3
    final: number;      // base * modifier (clamped 0-1)
    healthGrade: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    reasons?: string[];
  };
}

export interface OverlayMatch {
  id: string;                    // Historical date identifier
  similarity: number;            // 0..1
  phase: string;                 // Market phase at match time
  volatilityMatch: number;       // 0..1 how well volatility matches
  drawdownShape: number;         // 0..1 drawdown shape similarity
  stability: number;             // Pattern stability score
  
  windowNormalized: number[];    // Normalized prices for window period
  aftermathNormalized: number[]; // Normalized prices for aftermath
  
  return: number;                // Return over aftermath period
  maxDrawdown: number;           // Max drawdown over aftermath
  maxExcursion: number;          // Max favorable excursion
  
  // Per-horizon outcomes (for mini-metrics)
  outcomes: {
    ret7d?: number;
    ret14d?: number;
    ret30d?: number;
    ret90d?: number;
    ret180d?: number;
    ret365d?: number;
  };
}

export interface DistributionSeries {
  // Each array has length = aftermathDays
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
  timestamps?: number[];  // Optional: actual timestamps for each day
}

export interface OverlayPack {
  currentWindow: {
    raw: number[];
    normalized: number[];
    timestamps: number[];
  };
  matches: OverlayMatch[];
  distributionSeries: DistributionSeries;
  
  // Aggregate stats
  stats: {
    medianReturn: number;
    p10Return: number;
    p90Return: number;
    avgMaxDD: number;
    hitRate: number;        // % of positive outcomes
    sampleSize: number;
  };
}

export interface ForecastPack {
  path: number[];              // Central trajectory (p50 or weighted)
  pricePath?: number[];        // Alias for path (compatibility)
  upperBand: number[];         // Upper confidence band
  lowerBand: number[];         // Lower confidence band
  confidenceDecay: number[];   // 1 → 0 fade over horizon
  
  // Key markers
  markers: Array<{
    horizon: string;           // '7d', '14d', etc.
    dayIndex: number;          // Position in path array
    expectedReturn: number;
    price: number;
  }>;
  
  tailFloor: number;           // mcP95_DD protection level
  
  // Current reference
  currentPrice: number;
  startTs: number;
  
  // BLOCK 73.3: Unified path for frontend
  unifiedPath?: {
    anchorPrice: number;
    horizonDays: number;
    syntheticPath: Array<{ t: number; price: number; pct: number }>;
    replayPath: Array<{ t: number; price: number; pct: number }> | null;
    markers: Record<string, { horizon: string; t: number; price: number; pct: number }>;
  };
}

export interface FocusPackDiagnostics {
  sampleSize: number;
  effectiveN: number;
  entropy: number;
  reliability: number;
  coverageYears: number;       // How many years of data used
  qualityScore: number;        // Overall data quality 0..1
}

// ═══════════════════════════════════════════════════════════════
// BLOCK 73.1.1 — NORMALIZED SERIES (STRUCTURE % MODE)
// ═══════════════════════════════════════════════════════════════

export type AxisMode = 'RAW' | 'PERCENT';

export interface NormalizedSeries {
  mode: AxisMode;              // RAW for TIMING/TACTICAL, PERCENT for STRUCTURE
  basePrice: number;           // Reference price (NOW)
  
  // Forecast path in both formats
  rawPath: number[];           // Raw price values
  percentPath: number[];       // % from NOW: ((value / now) - 1) * 100
  
  // Bands
  rawUpperBand: number[];
  rawLowerBand: number[];
  percentUpperBand: number[];
  percentLowerBand: number[];
  
  // Replay (primary match aftermath)
  rawReplay: number[];
  percentReplay: number[];
  
  // Y-axis range (computed for proper scaling)
  yRange: {
    minPercent: number;
    maxPercent: number;
    minPrice: number;
    maxPrice: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// PRIMARY MATCH (BLOCK 73.1)
// ═══════════════════════════════════════════════════════════════

export interface PrimaryMatchScores {
  similarity: number;          // Raw similarity (0..1)
  volatilityAlignment: number; // How well volatility matches (0..1)
  stabilityScore: number;      // Pattern stability (0..1)
  outcomeQuality: number;      // Risk-adjusted aftermath quality (0..1)
  recencyBonus: number;        // Recency factor (0..1)
}

export interface PrimaryMatch extends OverlayMatch {
  selectionScore: number;        // Composite weighted score (0..1)
  selectionRank: number;         // 1 = best
  scores: PrimaryMatchScores;
  selectionReason: string;
}

export interface PrimarySelection {
  primaryMatch: PrimaryMatch | null;
  candidateCount: number;
  selectionMethod: 'WEIGHTED_SCORE' | 'FALLBACK_FIRST' | 'NO_CANDIDATES';
}

// ═══════════════════════════════════════════════════════════════
// BLOCK 73.2 — DIVERGENCE ENGINE
// ═══════════════════════════════════════════════════════════════

export type DivergenceGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type DivergenceFlag = 
  | 'HIGH_DIVERGENCE'
  | 'LOW_CORR'
  | 'TERM_DRIFT'
  | 'DIR_MISMATCH'
  | 'PERFECT_MATCH';

export interface DivergenceMetrics {
  horizonDays: number;
  mode: AxisMode;
  
  // Core metrics (all in % for UI consistency)
  rmse: number;              // Root mean square error (%)
  mape: number;              // Mean absolute % error
  maxAbsDev: number;         // Max |synthetic - replay| (%)
  terminalDelta: number;     // End point divergence (%)
  directionalMismatch: number; // % of days with opposite direction
  corr: number;              // Pearson correlation on daily returns (-1 to 1)
  
  // Composite score
  score: number;             // 0..100 (higher = better alignment)
  grade: DivergenceGrade;    // A/B/C/D/F
  
  // Warning flags
  flags: DivergenceFlag[];
  
  // Debug/transparency
  samplePoints: number;      // Number of data points used
}

// ═══════════════════════════════════════════════════════════════
// BLOCK 73.3 — UNIFIED PATH
// ═══════════════════════════════════════════════════════════════

export interface UnifiedPathPoint {
  t: number;      // Day index (0 = NOW)
  price: number;  // Absolute price
  pct: number;    // % from NOW
}

export interface UnifiedPathMarker {
  horizon: string;
  t: number;
  price: number;
  pct: number;
}

export interface UnifiedPathData {
  anchorPrice: number;
  horizonDays: number;
  syntheticPath: UnifiedPathPoint[];
  replayPath: UnifiedPathPoint[] | null;
  markers: {
    d7?: UnifiedPathMarker;
    d14?: UnifiedPathMarker;
    d30?: UnifiedPathMarker;
    d90?: UnifiedPathMarker;
    d180?: UnifiedPathMarker;
    d365?: UnifiedPathMarker;
  };
}

// BLOCK 73.5.2: Phase Filter
export interface PhaseFilterInfo {
  phaseId: string;
  from: string;
  to: string;
  originalMatchCount: number;
  filteredMatchCount: number;
  active: boolean;
}

// ═══════════════════════════════════════════════════════════════
// U6 — SCENARIO PACK
// ═══════════════════════════════════════════════════════════════

export type ScenarioModel = 'synthetic' | 'replay' | 'hybrid';
export type ScenarioDataStatus = 'REAL' | 'FALLBACK';

export interface ScenarioCase {
  label: 'Bear' | 'Base' | 'Bull';
  percentile: 'P10' | 'P50' | 'P90';
  return: number;           // e.g., -0.207 for -20.7%
  targetPrice: number;      // basePrice * (1 + return)
  horizonLabel: string;     // e.g., "+30d"
}

export interface ScenarioPack {
  horizonDays: number;           // 7 | 14 | 30 | 90 | 180 | 365
  asOfDate: string;              // YYYY-MM-DD
  basePrice: number;             // spot price at NOW
  
  // Return percentiles
  returns: {
    p10: number;                 // Bear case return (e.g., -0.207)
    p50: number;                 // Base case return (e.g., 0.028)
    p90: number;                 // Bull case return (e.g., 0.17)
  };
  
  // Target prices (basePrice * (1 + return))
  targets: {
    p10: number;                 // Bear target price
    p50: number;                 // Base target price
    p90: number;                 // Bull target price
  };
  
  // Outcome probabilities
  probUp: number;                // Probability of positive outcome (0-1)
  probDown: number;              // Probability of negative outcome (0-1)
  
  // Risk metrics
  avgMaxDD: number;              // Average max drawdown within horizon (e.g., -0.167)
  tailRiskP95: number;           // 95th percentile worst case (e.g., -0.50)
  
  // Data quality
  sampleSize: number;            // Number of historical matches used
  dataStatus: ScenarioDataStatus;
  fallbackReason?: string;       // e.g., "insufficient_coverage", "no_matches"
  
  // Model source
  model: ScenarioModel;          // Which model produced this scenario
  
  // Pre-built scenario cards for frontend
  cases: ScenarioCase[];
}

// ═══════════════════════════════════════════════════════════════
// MAIN FOCUS PACK
// ═══════════════════════════════════════════════════════════════

export interface FocusPack {
  meta: FocusPackMeta;
  overlay: OverlayPack;
  forecast: ForecastPack;
  diagnostics: FocusPackDiagnostics;
  
  // BLOCK 73.1: Primary Match Selection
  primarySelection?: PrimarySelection;
  
  // BLOCK 73.1.1: Normalized Series (STRUCTURE % mode)
  normalizedSeries?: NormalizedSeries;
  
  // BLOCK 73.2: Divergence Engine
  divergence?: DivergenceMetrics;
  
  // BLOCK 73.3: Unified Path (single source of truth)
  unifiedPath?: UnifiedPathData;
  
  // BLOCK 73.5.2: Phase Filter
  phaseFilter?: PhaseFilterInfo | null;
  
  // U6: Scenario Pack (unified scenarios for UI)
  scenario?: ScenarioPack;
}

// ═══════════════════════════════════════════════════════════════
// TIER MAPPING
// ═══════════════════════════════════════════════════════════════

export function getFocusTier(focus: HorizonKey): 'TIMING' | 'TACTICAL' | 'STRUCTURE' {
  if (['7d', '14d'].includes(focus)) return 'TIMING';
  if (['30d', '90d'].includes(focus)) return 'TACTICAL';
  return 'STRUCTURE';
}

export function getTierLabel(tier: 'TIMING' | 'TACTICAL' | 'STRUCTURE'): string {
  switch (tier) {
    case 'TIMING': return 'Timing View';
    case 'TACTICAL': return 'Tactical View';
    case 'STRUCTURE': return 'Structure View';
  }
}
