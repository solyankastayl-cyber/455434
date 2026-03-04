/**
 * META-AWARE FORECAST TYPES
 * =========================
 * 
 * Types for forecasts that have been processed through Meta-Brain invariants.
 * These represent the FINAL, risk-adjusted predictions that the UI displays.
 * 
 * Architecture:
 *   Raw Exchange Prediction → Meta-Brain (invariants) → Meta-Aware Forecast → UI
 * 
 * The UI shows the final state AFTER risk rules are applied.
 * This ensures consistency between what the user sees and what the system would act on.
 */

import type { ForecastDirection, ForecastHorizon, ForecastPoint } from '../../exchange/forecast/forecast.types.js';

// ═══════════════════════════════════════════════════════════════
// META-AWARE FORECAST TYPES
// ═══════════════════════════════════════════════════════════════

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type MetaAction = 'BUY' | 'SELL' | 'AVOID';

/**
 * Applied overlay (risk rule that modified the forecast)
 */
export interface AppliedOverlay {
  id: string;           // Invariant or rule ID
  source: string;       // MACRO, ML, FUNDING, SYSTEM
  reason: string;       // Human-readable explanation
  effect: 'CAP_CONFIDENCE' | 'REDUCE_MOVE' | 'BLOCK_STRONG' | 'WARN';
  value?: number;       // Modifier value if applicable
}

/**
 * Caps applied to the forecast
 */
export interface ForecastCaps {
  confidenceCap?: number;     // Max confidence allowed
  moveCapPct?: number;        // Max expected move allowed
  strengthCapped?: boolean;   // Was STRONG downgraded?
}

/**
 * Meta-aware forecast output
 * This is what the chart endpoint returns after meta-brain processing
 */
export interface MetaAwareForecast {
  // Original raw values (for transparency)
  raw: {
    direction: ForecastDirection;
    confidence: number;
    expectedMovePct: number;
  };
  
  // Final risk-adjusted values (what UI displays)
  direction: ForecastDirection;
  confidence: number;
  expectedMovePct: number;
  targetPrice: number;
  
  // Risk assessment
  action: MetaAction;
  riskLevel: RiskLevel;
  
  // Applied overlays (rules that modified the forecast)
  appliedOverlays: AppliedOverlay[];
  
  // Caps applied
  caps: ForecastCaps;
  
  // Timestamps
  asOfTs: number;
  targetTs: number;
  
  // Meta info
  horizon: ForecastHorizon;
  isMetaAdjusted: boolean;   // True if any overlay was applied
}

/**
 * Context for meta-brain forecast adjustment
 */
export interface ForecastAdjustmentContext {
  // Forecast input
  asset: string;
  horizon: ForecastHorizon;
  direction: ForecastDirection;
  confidence: number;
  expectedMovePct: number;
  basePrice: number;
  
  // Market context
  macro: {
    regime: string;
    riskLevel: RiskLevel;
    fearGreed: number;
    btcDominance: number;
    confidenceMultiplier: number;
    blockedStrong: boolean;
    flags: string[];
  } | null;
  
  // Funding context
  funding: {
    rate: number | null;
    state: 'NORMAL' | 'ELEVATED' | 'EXTREME';
    annualized: number | null;
  } | null;
  
  // Regime context
  regime: {
    type: 'RANGE' | 'TREND' | 'SQUEEZE' | 'VOLATILE';
    confidence: number;
  } | null;
}

/**
 * Result from meta-brain adjustment
 */
export interface MetaBrainAdjustmentResult {
  direction: ForecastDirection;
  confidence: number;
  expectedMovePct: number;
  action: MetaAction;
  riskLevel: RiskLevel;
  appliedRules: AppliedOverlay[];
  caps: ForecastCaps;
}

console.log('[Intelligence] Meta-aware forecast types loaded');
