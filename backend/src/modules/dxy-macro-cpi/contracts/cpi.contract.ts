/**
 * CPI CONTRACT — D6 v2
 * 
 * ISOLATION: This layer reads DXY fractal output but does NOT modify it.
 * Core fractal logic is untouched.
 */

// ═══════════════════════════════════════════════════════════════
// FRED SERIES IDs
// ═══════════════════════════════════════════════════════════════

export const CPI_SERIES = {
  HEADLINE: 'CPIAUCSL',  // Consumer Price Index for All Urban Consumers
  CORE: 'CPILFESL',      // CPI Less Food and Energy
} as const;

// ═══════════════════════════════════════════════════════════════
// CPI DATA POINT (raw from FRED)
// ═══════════════════════════════════════════════════════════════

export interface CpiDataPoint {
  seriesId: string;
  date: Date;
  value: number;
  source: string;
}

// ═══════════════════════════════════════════════════════════════
// CPI METRICS (computed from raw points)
// ═══════════════════════════════════════════════════════════════

export interface CpiMetrics {
  latestValue: number;
  latestDate: string;
  yoy: number;           // Year-over-year % change
  mom: number;           // Month-over-month % change
  ann3m: number;         // 3-month annualized rate
  trendYoy3m: number;    // YoY change over last 3 months
}

// ═══════════════════════════════════════════════════════════════
// CPI REGIME
// ═══════════════════════════════════════════════════════════════

export type CpiRegime = 'COOLING' | 'REHEATING' | 'STABLE';

// ═══════════════════════════════════════════════════════════════
// CPI CONTEXT (full computed context)
// ═══════════════════════════════════════════════════════════════

export interface CpiContext {
  headline: CpiMetrics;
  core: CpiMetrics;
  regime: CpiRegime;
  pressure: number;      // -1 to +1, based on core YoY vs 2% target
  computedAt: string;
  dataPoints: {
    headline: number;
    core: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// CPI ADJUSTMENT
// ═══════════════════════════════════════════════════════════════

export interface CpiAdjustment {
  multiplier: number;    // 0.90 to 1.10
  score: number;         // raw score before clamping
  explain: string[];     // human-readable reasons
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const CPI_CONFIG = {
  // Target inflation rate (Fed's 2% target)
  TARGET_INFLATION: 0.02,
  
  // Pressure calculation: (coreYoy - 2%) / 3%
  PRESSURE_DIVISOR: 0.03,
  
  // Regime thresholds
  COOLING_TREND_THRESHOLD: -0.002,   // trendYoy3m < -0.2%
  REHEATING_TREND_THRESHOLD: 0.002,  // trendYoy3m > +0.2%
  REHEATING_ANN3M_MARGIN: 0.01,      // ann3m > yoy + 1%
  
  // Adjustment multiplier range
  CPI_SCORE_WEIGHT: 0.10,            // multiplier = 1 + 0.10 * pressure
  MIN_MULTIPLIER: 0.90,
  MAX_MULTIPLIER: 1.10,
  
  // Minimum data required
  MIN_DATA_POINTS: 13,               // At least 13 months for YoY
} as const;
