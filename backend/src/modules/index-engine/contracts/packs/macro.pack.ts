/**
 * MACRO PACK V2 — Institutional Level
 * 
 * State-space model with:
 * - Markov regime switching
 * - Regime persistence
 * - Horizon-specific impacts
 * - Learned component weights
 */

import { PathPoint, RegimeType, HorizonDays } from '../index.types.js';

// ═══════════════════════════════════════════════════════════════
// MACRO STATE (core of V2)
// ═══════════════════════════════════════════════════════════════

export interface MacroState {
  regime: RegimeType;
  regimeProbabilities: Record<RegimeType, number>;  // sum = 1
  confidence: number;           // 0..1
  persistence: number;          // 0..1 (Markov stay probability)
  
  scoreSigned: number;          // -1..1 (aggregate)
  scoreVector: Record<string, number>;  // components, normalized
  
  transitionHint?: string;      // e.g. "Likely shifting to TIGHTENING"
}

// ═══════════════════════════════════════════════════════════════
// MACRO DRIVERS (explainability)
// ═══════════════════════════════════════════════════════════════

export interface MacroDriver {
  key: string;                  // "rates", "inflation", etc.
  displayName: string;
  contribution: number;         // signed contribution to scoreSigned
  weight: number;               // learned weight (from correlation analysis)
  lagDays: number;              // optimal lag (learned)
  currentValue: number;         // raw value
  zscore: number;               // normalized
  tooltip: string;              // UI hover explanation
}

// ═══════════════════════════════════════════════════════════════
// HORIZON IMPACT (different for each horizon)
// ═══════════════════════════════════════════════════════════════

export interface HorizonImpact {
  horizonDays: HorizonDays;
  impactPct: number;            // e.g. -0.35 (%)
  impactBps: number;            // same in basis points
  bandWidenPct?: number;        // volatility expansion for this horizon
  confidence: number;           // 0..1
  
  // Regime-specific coefficients used
  coefficient: number;
  regimeBoost: number;
}

// ═══════════════════════════════════════════════════════════════
// MACRO APPLICATION (how to apply to hybrid)
// ═══════════════════════════════════════════════════════════════

export interface MacroApplication {
  method: 'PATH_SHIFT' | 'BAND_RESHAPE' | 'MIXTURE';
  clamp: {
    minPct: number;             // e.g. -5%
    maxPct: number;             // e.g. +5%
  };
  appliedImpact: number;        // actual impact after clamp
}

// ═══════════════════════════════════════════════════════════════
// MACRO PACK V2 (full contract)
// ═══════════════════════════════════════════════════════════════

export interface MacroPackV2 {
  state: MacroState;
  drivers: MacroDriver[];
  horizonImpacts: HorizonImpact[];
  application: MacroApplication;
  
  // Adjusted path (hybrid + macro)
  adjustedPath?: PathPoint[];
  adjustedBands?: {
    p10: PathPoint[];
    p90: PathPoint[];
  };
  
  // Metadata
  computedAt: string;
  dataQuality: {
    freshSeries: number;
    staleSeries: number;
    qualityScore: number;       // 0..100
  };
  
  validation: {
    isValid: boolean;
    reason?: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// MARKOV TRANSITION MATRIX
// ═══════════════════════════════════════════════════════════════

export interface MarkovTransitionMatrix {
  regimes: RegimeType[];
  matrix: number[][];           // P(regime_t+1 | regime_t)
  stationaryDistribution: Record<RegimeType, number>;
  calibratedAt: string;
  samplesUsed: number;
}
