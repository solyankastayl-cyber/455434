/**
 * FORECAST TYPES — Price Prediction Model
 * ========================================
 * 
 * ForecastEvent represents a fixed, time-bound prediction:
 * - targetPrice (where we expect price to go)
 * - horizon (24h)
 * - confidence bands (upper/lower)
 * - outcome (evaluated after horizon passes)
 * 
 * This is NOT a "soft signal" — it's a deterministic forecast.
 */

export type ForecastDirection = 'UP' | 'DOWN' | 'FLAT';
export type ForecastHorizon = '1D' | '7D' | '30D';
export type ForecastOutcomeLabel = 'TP' | 'FP' | 'FN' | 'WEAK';

/**
 * Outcome after horizon passes
 */
export interface ForecastOutcome {
  realPrice: number;
  realMovePct: number;        // actual % move (signed)
  deviationPct: number;       // |target - real| / base
  directionMatch: boolean;    // did direction match?
  hit: boolean;               // was real price within band?
  label: ForecastOutcomeLabel;
  evaluatedAt: number;        // timestamp when evaluated
}

/**
 * Main Forecast Event — stored in exchange_forecasts collection
 */
export interface ForecastEvent {
  _id?: string;
  id: string;

  asset: string;              // 'BTC', 'ETH', etc (without USDT)
  symbol: string;             // 'BTCUSDT'
  
  horizon: ForecastHorizon;   // '1D' only for now
  
  createdAt: number;          // timestamp of prediction
  evaluateAfter: number;      // createdAt + horizon (ms)
  
  // Price targets
  basePrice: number;          // price at prediction time
  targetPrice: number;        // expected price after horizon
  expectedMovePct: number;    // (target - base) / base * 100 (signed)
  
  // Confidence band
  upperBand: number;          // target * (1 + bandWidth)
  lowerBand: number;          // target * (1 - bandWidth)
  bandWidthPct: number;       // band width as %
  
  // Signal data
  direction: ForecastDirection;
  confidence: number;         // 0-1
  strength: number;           // 0-1, derived from model
  
  // Market snapshot at prediction time
  volatilitySnapshot: number; // ATR or similar
  regimeAtCreation?: string;  // market regime when created
  
  // Layer contributions (for multi-layer support)
  layers: {
    exchange: {
      score: number;          // 0-1
      contribution: number;   // % weight
    };
    onchain?: {
      score: number;
      contribution: number;
    };
    sentiment?: {
      score: number;
      contribution: number;
    };
  };
  
  // Evaluation state
  evaluated: boolean;
  outcome?: ForecastOutcome;
  
  // Metadata
  modelVersion: string;
  source: 'auto' | 'manual';
}

/**
 * Input for creating a forecast
 */
export interface CreateForecastInput {
  asset: string;
  currentPrice: number;
  direction: ForecastDirection;
  confidence: number;
  strength: number;
  volatility?: number;
  regime?: string;
  layers?: {
    exchange: { score: number };
    onchain?: { score: number };
    sentiment?: { score: number };
  };
}

/**
 * Forecast for API response (simplified)
 */
export interface ForecastPoint {
  ts: number;                 // prediction timestamp
  horizon: ForecastHorizon;
  basePrice: number;
  targetPrice: number;
  expectedMovePct: number;
  direction: ForecastDirection;
  confidence: number;
  upperBand: number;
  lowerBand: number;
  evaluated: boolean;
  outcome?: {
    label: ForecastOutcomeLabel;
    realPrice: number;
    deviationPct: number;
    directionMatch: boolean;
  };
}

/**
 * Metrics aggregation
 */
export interface ForecastMetrics {
  horizon: ForecastHorizon;
  sampleCount: number;
  evaluatedCount: number;
  
  directionMatchPct: number;  // % of correct directions
  hitRatePct: number;         // % within band
  avgDeviationPct: number;    // average |predicted - actual|
  
  // Block 20: Model Health metrics
  calibrationScore: number;   // 0-100, how well confidence matches accuracy
  expectedCalibration: number; // expected accuracy based on avg confidence
  modelScore: number;         // overall model health 0-100
  
  breakdown: {
    tp: number;
    fp: number;
    fn: number;
    weak: number;
  };
  
  // Confidence buckets for calibration
  confidenceBuckets?: Array<{
    range: string;            // e.g. "60-70%"
    count: number;
    accuracy: number;         // actual accuracy in this bucket
    expectedAccuracy: number; // midpoint of confidence range
  }>;
}

/**
 * Price vs Expectation chart payload
 */
export interface PriceVsExpectationPayload {
  asset: string;
  range: string;
  horizon: ForecastHorizon;
  
  price: Array<{ ts: number; price: number; volume?: number }>;
  
  layers: {
    exchange: {
      forecastHistory: ForecastPoint[];
      futurePoint: ForecastPoint | null;
      futureBand: {
        ts: number;
        upper: number;
        lower: number;
      } | null;
    };
    meta: {
      forecastHistory: ForecastPoint[];
      futurePoint: ForecastPoint | null;
      futureBand: {
        ts: number;
        upper: number;
        lower: number;
      } | null;
    };
  };
  
  outcomeMarkers: Array<{
    ts: number;
    label: ForecastOutcomeLabel;
    direction: ForecastDirection;
    expectedMovePct: number;
    actualMovePct: number;
    confidence: number;
  }>;
  
  metrics: ForecastMetrics;
  
  drivers: {
    exchange: number;
    onchain: number;
    sentiment: number;
    directionBias: ForecastDirection;
  };
}

console.log('[Forecast] Types loaded');
