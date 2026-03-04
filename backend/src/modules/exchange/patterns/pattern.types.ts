/**
 * S10.5 — Exchange Patterns Library
 * 
 * CONTRACTS (LOCKED)
 * 
 * Patterns explain market behavior, NOT predict it.
 * - NO signals
 * - NO predictions
 * - NO BUY/SELL
 * - Only "what is happening and why"
 */

// ═══════════════════════════════════════════════════════════════
// PATTERN ENUMS
// ═══════════════════════════════════════════════════════════════

export type PatternCategory = 
  | 'FLOW'        // Order flow patterns
  | 'OI'          // Open interest patterns
  | 'LIQUIDATION' // Liquidation-based patterns
  | 'VOLUME'      // Volume patterns
  | 'STRUCTURE';  // Market structure patterns

export type PatternDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export type PatternStrength = 'WEAK' | 'MEDIUM' | 'STRONG';

export type PatternTimeframe = 'SCALP' | 'INTRADAY' | 'SWING';

// ═══════════════════════════════════════════════════════════════
// PATTERN DEFINITION (Library entry)
// ═══════════════════════════════════════════════════════════════

export interface PatternDefinition {
  id: string;
  name: string;
  category: PatternCategory;
  description: string;
  defaultTimeframe: PatternTimeframe;
  
  // Detection thresholds (configurable per pattern)
  thresholds: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════
// DETECTED PATTERN (Runtime instance)
// ═══════════════════════════════════════════════════════════════

export interface ExchangePattern {
  id: string;                     // Unique detection ID
  patternId: string;              // Reference to PatternDefinition.id
  symbol: string;
  name: string;
  category: PatternCategory;
  
  direction: PatternDirection;
  strength: PatternStrength;
  confidence: number;             // 0..1 — how well conditions match
  
  conditions: string[];           // Human-readable conditions met
  metrics: Record<string, any>;   // Raw data that triggered detection
  
  detectedAt: number;             // Unix timestamp ms
  timeframe: PatternTimeframe;
  
  // Optional: historical context
  historicalSuccessRate?: number;
}

// ═══════════════════════════════════════════════════════════════
// PATTERN STATE (Per symbol)
// ═══════════════════════════════════════════════════════════════

export interface PatternState {
  symbol: string;
  patterns: ExchangePattern[];
  
  // Conflict detection
  hasConflict: boolean;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  
  // Metadata
  lastUpdated: number;
  detectionDurationMs: number;
}

// ═══════════════════════════════════════════════════════════════
// DETECTION INPUT (Aggregated market state)
// ═══════════════════════════════════════════════════════════════

export interface PatternDetectionInput {
  symbol: string;
  
  // From S10.2 Order Flow
  orderFlow?: {
    aggressor: 'BUYER' | 'SELLER' | 'BALANCED';
    dominance: number;
    intensity: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    buyVolume: number;
    sellVolume: number;
  };
  
  // From S10.2 Absorption
  absorption?: {
    detected: boolean;
    side: 'BID' | 'ASK' | null;
    strength: number;
    priceHolding: boolean;
  };
  
  // From S10.2 Pressure
  pressure?: {
    imbalance: number;       // -1..1
    bidPressure: number;
    askPressure: number;
  };
  
  // From S10.3 Regime
  regime?: {
    type: string;
    confidence: number;
    volumeDelta: number;
    oiDelta: number;
    priceDelta: number;
  };
  
  // From S10.4 Liquidation
  liquidation?: {
    active: boolean;
    direction: 'LONG' | 'SHORT' | null;
    phase: string | null;
    intensity: string;
    volumeUsd: number;
  };
  
  // Raw metrics
  volume?: {
    current: number;
    average: number;
    ratio: number;           // current / average
  };
  
  oi?: {
    current: number;
    delta: number;
    deltaPct: number;
  };
  
  price?: {
    current: number;
    delta: number;
    deltaPct: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// ADMIN DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════

export interface PatternDiagnostics {
  symbol: string;
  
  // Detection input snapshot
  input: PatternDetectionInput;
  
  // All patterns evaluated
  evaluated: Array<{
    patternId: string;
    name: string;
    matched: boolean;
    reason: string;
    conditionsMet: string[];
    conditionsNotMet: string[];
  }>;
  
  // Final output
  detectedPatterns: ExchangePattern[];
  
  // Timing
  evaluatedAt: number;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════
// PATTERN HISTORY ENTRY
// ═══════════════════════════════════════════════════════════════

export interface PatternHistoryEntry {
  symbol: string;
  patternId: string;
  name: string;
  category: PatternCategory;
  direction: PatternDirection;
  
  startedAt: number;
  endedAt: number | null;
  durationSec: number;
  
  peakConfidence: number;
  
  // What happened after
  priceChangeAfter?: number;
}
