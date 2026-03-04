/**
 * S10.6 — Exchange Observation Dataset
 * S10.6I — Market Indicators Layer Integration
 * 
 * CONTRACTS (LOCKED)
 * 
 * Pure observation data — NO signals, NO predictions, NO verdicts.
 * This is the foundation for S10.7 ML and S10.8 Meta-Brain.
 */

import { ExchangePattern, PatternCategory, PatternDirection } from '../patterns/pattern.types.js';
import { IndicatorCategory } from '../indicators/indicator.types.js';

// ═══════════════════════════════════════════════════════════════
// REGIME TYPE (from S10.3)
// ═══════════════════════════════════════════════════════════════

export type RegimeType = 
  | 'ACCUMULATION'
  | 'DISTRIBUTION'
  | 'LONG_SQUEEZE'
  | 'SHORT_SQUEEZE'
  | 'EXPANSION'
  | 'EXHAUSTION'
  | 'NEUTRAL';

// ═══════════════════════════════════════════════════════════════
// INDICATOR VALUE (for storage in ObservationRow)
// ═══════════════════════════════════════════════════════════════

export interface StoredIndicatorValue {
  value: number;
  category: IndicatorCategory;
  normalized: boolean;
}

export interface IndicatorsMeta {
  completeness: number;     // 0..1
  indicatorCount: number;   // <=36 (30 base + 6 whale)
  missing: string[];        // ids that failed to calculate
  source: 'polling' | 'replay' | 'manual';
}

// ═══════════════════════════════════════════════════════════════
// S10.W — WHALE META (Step 4)
// ═══════════════════════════════════════════════════════════════

export interface WhaleMeta {
  /** Active whale positions count */
  activeWhales: number;
  
  /** Dominant whale side */
  dominantSide: 'LONG' | 'SHORT' | 'BALANCED';
  
  /** Largest position in USD */
  largestPositionUsd: number;
  
  /** Average leverage of whale positions */
  avgLeverage: number;
  
  /** Data provider */
  provider: 'hyperliquid' | 'binance' | 'bybit' | 'aggregated';
  
  /** Provider health status */
  health: 'UP' | 'DEGRADED' | 'DOWN';
  
  /** Data staleness in seconds */
  dataAgeSec: number;
  
  /** Confidence level 0..1 */
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// OBSERVATION ROW (Main data structure — EXTENDED with Indicators)
// ═══════════════════════════════════════════════════════════════

export interface ExchangeObservationRow {
  id: string;
  symbol: string;
  timestamp: number;

  // Market state
  market: {
    price: number;
    priceChange5m: number;
    priceChange15m: number;
    volatility: number;
  };

  volume: {
    total: number;
    delta: number;
    ratio: number;       // current / average
  };

  openInterest: {
    value: number;
    delta: number;
    deltaPct: number;
  };

  orderFlow: {
    aggressorBias: 'BUY' | 'SELL' | 'NEUTRAL';
    dominance: number;
    absorption: boolean;
    absorptionSide: 'BID' | 'ASK' | null;
    imbalance: number;   // -1..1
  };

  liquidations: {
    longVolume: number;
    shortVolume: number;
    cascadeActive: boolean;
    cascadeDirection: 'LONG' | 'SHORT' | null;
    cascadePhase: string | null;
  };

  regime: {
    type: RegimeType;
    confidence: number;
  };

  // Detected patterns (summary)
  patterns: ObservationPatternSummary[];
  patternCount: number;
  hasConflict: boolean;
  bullishPatterns: number;
  bearishPatterns: number;
  neutralPatterns: number;

  // S10.6I — Market Indicators (36 total: 30 base + 6 whale)
  indicators: Record<string, StoredIndicatorValue>;
  indicatorsMeta: IndicatorsMeta;

  // S10.W — Whale Intelligence (Step 4)
  whaleMeta?: WhaleMeta;

  // Meta
  createdAt: number;
  source?: 'polling' | 'replay' | 'manual';
}

// ═══════════════════════════════════════════════════════════════
// PATTERN SUMMARY (Compact version for storage)
// ═══════════════════════════════════════════════════════════════

export interface ObservationPatternSummary {
  patternId: string;
  name: string;
  category: PatternCategory;
  direction: PatternDirection;
  strength: string;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// OBSERVATION STATS
// ═══════════════════════════════════════════════════════════════

export interface ObservationStats {
  totalObservations: number;
  observationsBySymbol: Record<string, number>;
  
  // Pattern frequency
  patternFrequency: Record<string, number>;
  categoryFrequency: Record<PatternCategory, number>;
  
  // Regime distribution
  regimeDistribution: Record<RegimeType, number>;
  
  // Conflict stats
  conflictCount: number;
  conflictRate: number;  // 0..1
  
  // Time range
  firstObservation: number | null;
  lastObservation: number | null;
  
  // Rate
  observationsPerHour: number;
}

// ═══════════════════════════════════════════════════════════════
// QUERY PARAMS
// ═══════════════════════════════════════════════════════════════

export interface ObservationQuery {
  symbol?: string;
  startTime?: number;
  endTime?: number;
  regime?: RegimeType;
  hasPatterns?: boolean;
  hasConflict?: boolean;
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════════
// REGIME × PATTERN MATRIX
// ═══════════════════════════════════════════════════════════════

export interface RegimePatternMatrix {
  // regime -> pattern -> count
  matrix: Record<RegimeType, Record<string, number>>;
  totalSamples: number;
}

// ═══════════════════════════════════════════════════════════════
// OBSERVATION INPUT (from other S10 modules)
// ═══════════════════════════════════════════════════════════════

export interface CreateObservationInput {
  symbol: string;
  
  // From S10.1
  market?: {
    price: number;
    priceChange5m?: number;
    priceChange15m?: number;
    volatility?: number;
  };
  
  volume?: {
    total: number;
    delta?: number;
    ratio?: number;
  };
  
  openInterest?: {
    value: number;
    delta?: number;
    deltaPct?: number;
  };
  
  // From S10.2
  orderFlow?: {
    aggressorBias: 'BUY' | 'SELL' | 'NEUTRAL';
    dominance?: number;
    absorption?: boolean;
    absorptionSide?: 'BID' | 'ASK' | null;
    imbalance?: number;
  };
  
  // From S10.4
  liquidations?: {
    longVolume?: number;
    shortVolume?: number;
    cascadeActive?: boolean;
    cascadeDirection?: 'LONG' | 'SHORT' | null;
    cascadePhase?: string | null;
  };
  
  // From S10.3
  regime?: {
    type: RegimeType;
    confidence?: number;
  };
  
  // From S10.5
  patterns?: ExchangePattern[];
  
  // From S10.W — Whale Intelligence (Step 4)
  whaleMeta?: WhaleMeta;
  
  // Phase 1.1 — Source metadata for real data tracking
  sourceMeta?: {
    dataMode: 'LIVE' | 'MIXED' | 'MOCK';
    providersUsed: string[];
    latencyMs?: Record<string, number>;
    missing?: string[];
    timestamp?: number;
  };
}
