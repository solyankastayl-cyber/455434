/**
 * S10.LABS — Research & Analytics Types
 * 
 * LABS-01: Regime → Forward Outcome
 * 
 * RULES:
 * - Read-only (no mutations)
 * - No signals, no predictions
 * - Causal-only (t1 >= t0 + horizon)
 * - Statistics, not recommendations
 */

import { RegimeType } from '../observation/observation.types.js';

// ═══════════════════════════════════════════════════════════════
// COMMON TYPES
// ═══════════════════════════════════════════════════════════════

export type Horizon = '5m' | '15m' | '1h' | '4h' | '24h';
export type Window = '24h' | '7d' | '30d';
export type RegimeSource = 'indicator' | 'legacy' | 'dual';
export type StressMetric = 'marketStress' | 'orderbookPressure' | 'positionCrowding';

// ═══════════════════════════════════════════════════════════════
// LABS-01: REGIME FORWARD OUTCOME
// ═══════════════════════════════════════════════════════════════

export interface RegimeForwardQuery {
  symbol: string;
  horizon: Horizon;
  window: Window;
  regimeSource: RegimeSource;
  minStabilityTicks: number;
  stressMetric: StressMetric;
  bucketSize: number; // for distribution buckets
}

export interface RegimeForwardMeta {
  symbol: string;
  horizon: Horizon;
  window: Window;
  regimeSource: RegimeSource;
  minStabilityTicks: number;
  stressMetric: StressMetric;
  generatedAt: string; // ISO
}

export interface RegimeForwardTotals {
  observations: number;
  usablePairs: number;      // t0 -> t+h pairs found
  droppedNoForward: number; // no t+h observation
  droppedUnstable: number;  // stability < minStabilityTicks
}

export interface RegimeDistributionItem {
  regime: RegimeType;
  count: number;
  pct: number; // 0..100
}

export interface StressBucket {
  bucket: string;  // e.g., "-0.2..-0.1", "0.0..0.1"
  count: number;
  pct: number;
}

export interface StressDelta {
  mean: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
  buckets: StressBucket[];
}

export interface PatternTrigger {
  patternId: string;
  count: number;
  pct: number;
}

export interface RegimeForwardEntry {
  regime: RegimeType;
  sampleCount: number;
  
  // What regime comes next
  nextRegimeDist: RegimeDistributionItem[];
  regimeChangeRate: number; // 0..1
  
  // Stress changes
  stressDelta: StressDelta;
  
  // Cascade probability
  cascadeRate: number; // 0..1
  
  // Top patterns before cascade (optional)
  patternTriggersTop: PatternTrigger[];
}

export interface RegimeForwardNotes {
  interpretation: string[];
}

export interface RegimeForwardResponse {
  ok: boolean;
  meta: RegimeForwardMeta;
  totals: RegimeForwardTotals;
  byRegime: RegimeForwardEntry[];
  notes: RegimeForwardNotes;
}

// ═══════════════════════════════════════════════════════════════
// HELPER CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const HORIZON_MS: Record<Horizon, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

// For testing with mock data (close timestamps), use smaller horizons
export const HORIZON_MS_MOCK: Record<Horizon, number> = {
  '5m': 100, // 100ms for mock
  '15m': 200,
  '1h': 500,
  '4h': 1000,
  '24h': 2000,
};

export const WINDOW_MS: Record<Window, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// Cascade detection thresholds (unified with S10.4)
export const CASCADE_THRESHOLDS = {
  intensityMin: 0.6,
  stressMin: 0.7,
  volumeMultiplier: 3,
};

console.log('[S10.LABS] Labs types loaded');
