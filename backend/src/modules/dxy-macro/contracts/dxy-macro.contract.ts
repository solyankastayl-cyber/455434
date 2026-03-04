/**
 * DXY MACRO CONTRACT — D6 v1
 * 
 * ISOLATION: This layer reads DXY fractal output but does NOT modify it.
 * Core fractal logic is untouched.
 */

// ═══════════════════════════════════════════════════════════════
// RATE CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface RateContext {
  currentRate: number;
  delta3m: number;
  delta12m: number;
  regime: 'tightening' | 'easing' | 'neutral';
  momentum: 'up' | 'down' | 'flat';
  asOf: string;
  dataPoints: number;
}

// ═══════════════════════════════════════════════════════════════
// MACRO ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

export interface MacroAdjustment {
  multiplier: number;
  reason: string;
  regime: string;
  direction: 'amplify' | 'dampen' | 'neutral';
}

// ═══════════════════════════════════════════════════════════════
// DXY MACRO RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface DxyMacroResponse {
  ok: boolean;
  fractal: {
    forecastReturn: number;
    entropy: number;
    similarity: number;
    hybridReturn?: number;
    action: string;
  };
  macroContext: RateContext;
  macroAdjustment: MacroAdjustment;
  adjustedForecastReturn: number;
  processingTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════
// FED FUNDS DATA POINT
// ═══════════════════════════════════════════════════════════════

export interface FedFundsDataPoint {
  date: Date;
  value: number;
  source: string;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const MACRO_CONFIG = {
  // Regime thresholds (12-month delta)
  TIGHTENING_THRESHOLD: 1.0,  // > 1.0 = tightening
  EASING_THRESHOLD: -1.0,     // < -1.0 = easing
  
  // Adjustment multipliers
  TIGHTENING_AMPLIFY: 1.15,   // Amplify signal by 15%
  EASING_DAMPEN: 0.85,        // Dampen signal by 15%
  NEUTRAL_MULT: 1.0,          // No adjustment
  
  // Minimum data required
  MIN_DATA_POINTS: 13,        // 13 months for 12m delta
} as const;
