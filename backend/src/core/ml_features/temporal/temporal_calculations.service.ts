/**
 * Temporal Calculations Service
 * 
 * EPIC 7: Pure math functions for temporal feature calculation
 * NO database access, NO side effects
 * 
 * Implements:
 * - Delta (Δ): absolute and percentage change
 * - Slope: linear regression coefficient  
 * - Acceleration: change in slope (2nd derivative)
 * - Consistency: direction stability score
 * - Regime: phase classification (STARTING/PEAKING/FADING/NOISE)
 */

import type { 
  TemporalFeatures, 
  Regime, 
  TimeSeriesPoint 
} from './temporal.types.js';

// Small epsilon to prevent division by zero
const EPSILON = 1e-8;

// Threshold for noise detection
const SLOPE_NOISE_THRESHOLD = 0.001;
const CONSISTENCY_NOISE_THRESHOLD = 0.3;

/**
 * Calculate Delta (absolute change)
 * Δ = last_value - first_value
 */
export function calculateDelta(series: number[]): number {
  if (series.length < 2) return 0;
  
  const first = series[0];
  const last = series[series.length - 1];
  
  return last - first;
}

/**
 * Calculate Delta Percentage (relative change)
 * Δ% = (last - first) / max(|first|, ε)
 */
export function calculateDeltaPct(series: number[]): number {
  if (series.length < 2) return 0;
  
  const first = series[0];
  const last = series[series.length - 1];
  
  const denominator = Math.max(Math.abs(first), EPSILON);
  return (last - first) / denominator;
}

/**
 * Calculate Slope using linear regression
 * slope = cov(t, x) / var(t)
 * 
 * Uses indices as time (0, 1, 2, ..., n-1)
 */
export function calculateSlope(series: number[]): number {
  const n = series.length;
  if (n < 2) return 0;
  
  // Time indices
  const times = Array.from({ length: n }, (_, i) => i);
  
  // Means
  const meanT = times.reduce((a, b) => a + b, 0) / n;
  const meanX = series.reduce((a, b) => a + b, 0) / n;
  
  // Covariance and variance
  let cov = 0;
  let varT = 0;
  
  for (let i = 0; i < n; i++) {
    const dt = times[i] - meanT;
    const dx = series[i] - meanX;
    cov += dt * dx;
    varT += dt * dt;
  }
  
  if (varT < EPSILON) return 0;
  
  return cov / varT;
}

/**
 * Calculate Acceleration (2nd derivative)
 * acc = slope_current - slope_previous
 * 
 * Splits series into two halves and compares slopes
 */
export function calculateAcceleration(series: number[]): number {
  const n = series.length;
  if (n < 4) return 0;
  
  const mid = Math.floor(n / 2);
  
  // First half slope
  const firstHalf = series.slice(0, mid);
  const slopePrevious = calculateSlope(firstHalf);
  
  // Second half slope
  const secondHalf = series.slice(mid);
  const slopeCurrent = calculateSlope(secondHalf);
  
  return slopeCurrent - slopePrevious;
}

/**
 * Calculate Consistency (direction stability)
 * consistency = consecutive_same_direction / total_moves
 * 
 * Returns value in [0, 1]
 * High consistency = stable trend
 * Low consistency = choppy/noise
 */
export function calculateConsistency(series: number[]): number {
  const n = series.length;
  if (n < 2) return 0;
  
  let positiveMoves = 0;
  let negativeMoves = 0;
  let consecutiveSame = 0;
  let maxConsecutive = 0;
  let lastDirection: 'up' | 'down' | null = null;
  
  for (let i = 1; i < n; i++) {
    const diff = series[i] - series[i - 1];
    
    if (Math.abs(diff) < EPSILON) continue; // Skip flat moves
    
    const direction: 'up' | 'down' = diff > 0 ? 'up' : 'down';
    
    if (direction === 'up') {
      positiveMoves++;
    } else {
      negativeMoves++;
    }
    
    if (direction === lastDirection) {
      consecutiveSame++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveSame);
    } else {
      consecutiveSame = 1;
    }
    
    lastDirection = direction;
  }
  
  const totalMoves = positiveMoves + negativeMoves;
  if (totalMoves === 0) return 0;
  
  // Method 1: Dominance of one direction
  const directionDominance = Math.abs(positiveMoves - negativeMoves) / totalMoves;
  
  // Method 2: Consecutive same direction
  const consecutiveRatio = maxConsecutive / totalMoves;
  
  // Combine both (weighted average)
  const consistency = 0.6 * directionDominance + 0.4 * consecutiveRatio;
  
  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, consistency));
}

/**
 * Detect Regime based on slope and acceleration
 * 
 * STARTING: slope > 0 && acceleration > 0 (beginning of uptrend)
 * PEAKING:  slope > 0 && acceleration < 0 (near top, slowing)
 * FADING:   slope < 0 (downtrend)
 * NOISE:    |slope| < threshold (no clear direction)
 */
export function detectRegime(slope: number, acceleration: number, consistency: number): Regime {
  // Noise detection: low slope or low consistency
  if (Math.abs(slope) < SLOPE_NOISE_THRESHOLD || consistency < CONSISTENCY_NOISE_THRESHOLD) {
    return 'NOISE';
  }
  
  // Fading: negative slope
  if (slope < 0) {
    return 'FADING';
  }
  
  // Positive slope - determine if starting or peaking
  if (acceleration > 0) {
    return 'STARTING';
  } else {
    return 'PEAKING';
  }
}

/**
 * Calculate all temporal features for a series
 */
export function calculateTemporalFeatures(series: number[]): TemporalFeatures {
  const delta = calculateDelta(series);
  const deltaPct = calculateDeltaPct(series);
  const slope = calculateSlope(series);
  const acceleration = calculateAcceleration(series);
  const consistency = calculateConsistency(series);
  const regime = detectRegime(slope, acceleration, consistency);
  
  return {
    delta,
    deltaPct,
    slope,
    acceleration,
    consistency,
    regime,
  };
}

/**
 * Extract values from time series points
 */
export function extractValues(points: TimeSeriesPoint[]): number[] {
  return points.map(p => p.value);
}

/**
 * Filter series to window (most recent N hours)
 */
export function filterToWindow(
  points: TimeSeriesPoint[], 
  windowHours: number,
  referenceTime?: Date
): TimeSeriesPoint[] {
  const now = referenceTime || new Date();
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  
  return points.filter(p => p.timestamp >= cutoff);
}

/**
 * Validate series has enough data points
 */
export function hasEnoughData(series: number[], minPoints: number = 3): boolean {
  return series.length >= minPoints;
}

/**
 * Safe feature calculation with fallback for insufficient data
 */
export function safeCalculateFeatures(series: number[]): TemporalFeatures {
  if (!hasEnoughData(series)) {
    return {
      delta: 0,
      deltaPct: 0,
      slope: 0,
      acceleration: 0,
      consistency: 0,
      regime: 'NOISE',
    };
  }
  
  return calculateTemporalFeatures(series);
}
