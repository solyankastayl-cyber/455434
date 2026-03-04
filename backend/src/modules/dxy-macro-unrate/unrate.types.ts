/**
 * UNRATE TYPES — D6 v3
 * 
 * ISOLATION: This layer reads DXY fractal output but does NOT modify it.
 * Core fractal logic is untouched.
 */

// ═══════════════════════════════════════════════════════════════
// FRED SERIES
// ═══════════════════════════════════════════════════════════════

export const UNRATE_SERIES = 'UNRATE';  // Civilian Unemployment Rate

// ═══════════════════════════════════════════════════════════════
// UNRATE DATA POINT (raw from FRED)
// ═══════════════════════════════════════════════════════════════

export interface UnrateDataPoint {
  seriesId: string;
  date: Date;
  value: number;  // Percentage, e.g. 4.1
  source: string;
}

// ═══════════════════════════════════════════════════════════════
// UNRATE TREND
// ═══════════════════════════════════════════════════════════════

export type UnrateTrend = 'UP' | 'DOWN' | 'FLAT';

// ═══════════════════════════════════════════════════════════════
// UNRATE REGIME
// ═══════════════════════════════════════════════════════════════

export type UnrateRegime = 'TIGHT' | 'NORMAL' | 'STRESS';

// ═══════════════════════════════════════════════════════════════
// UNRATE CONTEXT (computed)
// ═══════════════════════════════════════════════════════════════

export interface UnrateContext {
  current: number;       // Current unemployment rate (e.g. 4.1)
  delta3m: number;       // Change over 3 months (percentage points)
  delta12m: number;      // Change over 12 months (percentage points)
  trend: UnrateTrend;    // UP/DOWN/FLAT based on delta3m
  regime: UnrateRegime;  // TIGHT/NORMAL/STRESS based on current level
  pressure: number;      // -1 to +1
  asOf: string;          // Date of latest data
  dataPoints: number;    // Total data points available
}

// ═══════════════════════════════════════════════════════════════
// UNRATE ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

export interface UnrateAdjustment {
  multiplier: number;    // 0.90 to 1.10
  pressure: number;      // Raw pressure score
  reasons: string[];     // Human-readable explanation
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const UNRATE_CONFIG = {
  // Regime thresholds
  TIGHT_THRESHOLD: 4.0,    // <= 4.0% = tight labor market
  STRESS_THRESHOLD: 6.0,   // > 6.0% = stressed labor market
  
  // Trend thresholds (percentage points)
  TREND_UP_THRESHOLD: 0.2,    // delta3m > +0.2pp = UP
  TREND_DOWN_THRESHOLD: -0.2, // delta3m < -0.2pp = DOWN
  
  // Pressure calculation: clamp(delta12m / 2.0, -1, +1)
  PRESSURE_SCALE: 2.0,  // 2pp = full scale
  
  // Adjustment multiplier
  UNRATE_WEIGHT: 0.10,       // multiplier = 1 + pressure * 0.10
  MIN_MULTIPLIER: 0.90,
  MAX_MULTIPLIER: 1.10,
  
  // Minimum data required
  MIN_DATA_POINTS: 13,       // 13 months for delta12m
} as const;
