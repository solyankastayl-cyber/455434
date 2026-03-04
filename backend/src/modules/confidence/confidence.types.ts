/**
 * PHASE 2.3 — Confidence Decay Types
 * ====================================
 * 
 * Types for confidence decay based on historical accuracy.
 * 
 * PURPOSE:
 * Penalize system confidence when historical verdicts don't confirm.
 * 
 * IMMUTABLE CONTRACT v1
 * ---------------------
 * - decayFactor ∈ [0.3, 1.0]
 * - Based purely on historical truth data
 * - NO ML, just rule-based memory
 */

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE RECORD
// ═══════════════════════════════════════════════════════════════

export interface ConfidenceRecord {
  recordId: string;
  symbol: string;
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'ALL';

  // Historical stats
  windowBars: number;           // lookback window in bars
  total: number;                // total verdicts in window
  confirmed: number;            // confirmed verdicts
  diverged: number;             // diverged verdicts

  // Decay calculation
  confirmationRate: number;     // confirmed / total
  decayFactor: number;          // 0.3..1.0

  // Applied confidence
  rawConfidence: number;        // original confidence
  adjustedConfidence: number;   // rawConfidence × decayFactor

  // Metadata
  calculatedAt: number;
  version: 'v1';
}

// ═══════════════════════════════════════════════════════════════
// DECAY CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface DecayConfig {
  minDecay: number;             // minimum decay factor (default: 0.3)
  maxDecay: number;             // maximum decay factor (default: 1.0)
  windowBars: number;           // lookback window (default: 168 = 7 days)
  minSampleSize: number;        // minimum samples for decay (default: 10)
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  minDecay: 0.3,
  maxDecay: 1.0,
  windowBars: 168,   // 7 days for 1h timeframe
  minSampleSize: 10,
};

// ═══════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface DecayResponse {
  ok: boolean;
  symbol: string;
  decayFactor: number;
  adjustedConfidence: number;
  record: ConfidenceRecord;
}

export interface DecayStatsResponse {
  ok: boolean;
  symbol: string;
  overall: {
    total: number;
    confirmed: number;
    diverged: number;
    confirmationRate: number;
    decayFactor: number;
  };
  byVerdict: {
    BULLISH: { total: number; confirmed: number; decayFactor: number };
    BEARISH: { total: number; confirmed: number; decayFactor: number };
    NEUTRAL: { total: number; confirmed: number; decayFactor: number };
  };
}

console.log('[Phase 2.3] Confidence Decay Types loaded');
