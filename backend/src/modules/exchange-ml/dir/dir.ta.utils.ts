/**
 * Direction Model Technical Analysis Utilities
 * =============================================
 * 
 * Helper functions for calculating technical indicators
 * used in the Direction feature extractor.
 */

// ═══════════════════════════════════════════════════════════════
// EMA - Exponential Moving Average
// ═══════════════════════════════════════════════════════════════

export function ema(values: number[], period: number): number | null {
  if (!values?.length || values.length < period) return null;
  
  const k = 2 / (period + 1);
  
  // Initialize with SMA of first 'period' values
  let emaPrev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // Calculate EMA for remaining values
  for (let i = period; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k);
  }
  
  return emaPrev;
}

// ═══════════════════════════════════════════════════════════════
// SMA - Simple Moving Average
// ═══════════════════════════════════════════════════════════════

export function sma(values: number[], period: number): number | null {
  if (!values?.length || values.length < period) return null;
  
  const slice = values.slice(values.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ═══════════════════════════════════════════════════════════════
// VWAP - Volume Weighted Average Price
// ═══════════════════════════════════════════════════════════════

export function vwap(closes: number[], volumes: number[], period: number): number | null {
  if (!closes?.length || closes.length < period) return null;
  if (!volumes?.length || volumes.length < period) return null;
  
  const c = closes.slice(closes.length - period);
  const v = volumes.slice(volumes.length - period);

  let priceVolume = 0;
  let totalVolume = 0;
  
  for (let i = 0; i < period; i++) {
    priceVolume += c[i] * v[i];
    totalVolume += v[i];
  }
  
  if (totalVolume <= 0) return null;
  return priceVolume / totalVolume;
}

// ═══════════════════════════════════════════════════════════════
// Clamp - Bound a value to a range
// ═══════════════════════════════════════════════════════════════

export function clamp(min: number, max: number, x: number): number {
  return Math.max(min, Math.min(max, x));
}

console.log('[Exchange ML] Direction TA utils loaded');
