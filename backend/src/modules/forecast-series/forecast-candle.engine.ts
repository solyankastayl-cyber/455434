/**
 * FORECAST CANDLE ENGINE
 * ======================
 * 
 * BLOCK F1: Candle Generation from Forecast Points
 * 
 * Converts ForecastPoint[] -> ForecastCandle[]
 * 
 * Key formula:
 * - body = basePrice * (1 + expectedMovePct * confidence)
 * - range = volatility * (1 - confidence * 0.7)
 * 
 * Higher confidence = larger body, tighter range
 * Lower confidence = smaller body, wider range
 */

import type { ForecastPoint, ForecastCandle } from './forecast-series.types.js';

/**
 * Clamp value between min and max
 */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Convert createdDay to unix timestamp (end of day)
 * Places forecast candle at day boundary for visual clarity
 */
function pointTimeUnix(point: ForecastPoint): number {
  // Place at end of forecast day (23:59 UTC)
  const iso = `${point.createdDay}T23:59:00.000Z`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

/**
 * Build a single forecast candle from a point
 */
export function buildForecastCandle(point: ForecastPoint): ForecastCandle {
  const conf = clamp(point.confidence, 0, 1);
  
  // Body size: expected move weighted by confidence
  // High confidence = full move, low confidence = reduced move
  const signedMove = point.expectedMovePct * conf;
  
  const open = point.basePrice;
  const close = point.basePrice * (1 + signedMove);
  
  // Range (high/low): based on volatility, narrowed by confidence
  // Default volatility 2% if not provided
  const vol = clamp(point.volatilityPct ?? 0.02, 0.005, 0.12);
  
  // Range shrinks as confidence increases (more certain = tighter range)
  // At confidence=1.0: rangePct = vol * 0.30
  // At confidence=0.0: rangePct = vol * 1.00
  const rangePct = vol * clamp(1.0 - conf * 0.7, 0.30, 1.0);
  
  const maxOC = Math.max(open, close);
  const minOC = Math.min(open, close);
  
  const high = maxOC * (1 + rangePct);
  const low = minOC * (1 - rangePct);
  
  return {
    time: pointTimeUnix(point),
    open,
    high,
    low,
    close,
    
    // Metadata for tooltips
    model: point.model,
    horizon: point.horizon,
    confidence: point.confidence,
    expectedMovePct: point.expectedMovePct,
    direction: point.direction,
  };
}

/**
 * Build multiple forecast candles from points array
 */
export function buildForecastCandles(points: ForecastPoint[]): ForecastCandle[] {
  return points.map(buildForecastCandle);
}

/**
 * Build line data (close values only) for line rendering mode
 */
export function buildForecastLine(points: ForecastPoint[]): Array<{ time: number; value: number }> {
  return points.map(point => {
    const conf = clamp(point.confidence, 0, 1);
    const signedMove = point.expectedMovePct * conf;
    const close = point.basePrice * (1 + signedMove);
    
    return {
      time: pointTimeUnix(point),
      value: close,
    };
  });
}

console.log('[ForecastCandleEngine] Module loaded (Block F1)');
