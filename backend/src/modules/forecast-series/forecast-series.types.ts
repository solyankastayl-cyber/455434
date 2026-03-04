/**
 * FORECAST SERIES TYPES
 * =====================
 * 
 * BLOCK F1: Forecast Persistence + Candle Engine
 * 
 * Types for time-series forecast storage.
 * Each forecast point is append-only and immutable.
 * History is never overwritten - this ensures forecast accountability.
 */

// Only active models for now - Combined + Exchange
// On-chain and Sentiment are frozen
export type ForecastModelKey = 'combined' | 'exchange';
export type ForecastHorizon = '1D' | '7D' | '30D';
export type ForecastDirection = 'UP' | 'DOWN' | 'FLAT';

/**
 * Single forecast point stored in MongoDB
 * Immutable - never updated after creation
 */
export type ForecastPoint = {
  symbol: string;              // "BTC", "ETH" ...
  model: ForecastModelKey;     // combined/exchange
  horizon: ForecastHorizon;    // 1D/7D/30D

  // Timestamp when forecast was generated
  createdAtIso: string;        // ISO string (full timestamp)
  createdDay: string;          // YYYY-MM-DD (for deduplication)

  // Base price at forecast time
  basePrice: number;

  // Forecast data
  expectedMovePct: number;     // e.g. 0.02 = +2%
  direction: ForecastDirection;
  confidence: number;          // 0..1

  // Optional: volatility for high/low calculation
  volatilityPct?: number;      // e.g. 0.018 (=1.8%)
  
  // Source tracking for audit
  source?: {
    verdictId?: string;
    engine?: string;
  };
};

/**
 * Forecast candle generated from ForecastPoint
 * For lightweight-charts rendering
 */
export type ForecastCandle = {
  time: number;      // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;

  // Metadata for tooltips
  model: ForecastModelKey;
  horizon: ForecastHorizon;
  confidence: number;
  expectedMovePct: number;
  direction: ForecastDirection;
};

/**
 * API response for forecast series endpoint
 */
export type ForecastSeriesResponse = {
  ok: boolean;
  symbol: string;
  model: ForecastModelKey;
  horizon: ForecastHorizon;
  points: ForecastPoint[];
  candles: ForecastCandle[];
};

/**
 * Snapshot request payload
 */
export type SnapshotRequest = {
  symbol: string;
  horizon: ForecastHorizon;
  models?: ForecastModelKey[];
};

console.log('[ForecastSeriesTypes] Types loaded (Block F1)');
