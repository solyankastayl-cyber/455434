/**
 * CHART TYPES — Central Chart Data Contracts
 * ==========================================
 * 
 * Types for price, prediction, and event data
 */

// ═══════════════════════════════════════════════════════════════
// TIMEFRAMES & RANGES
// ═══════════════════════════════════════════════════════════════

export type ChartTimeframe = '5m' | '15m' | '1h' | '4h' | '1d';
export type ChartRange = '24h' | '7d' | '30d' | '90d' | '1y';

export const RANGE_TO_POINTS: Record<ChartRange, number> = {
  '24h': 24,
  '7d': 168,
  '30d': 720,
  '90d': 2160,
  '1y': 8760,
};

export const RANGE_TO_MS: Record<ChartRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════════════
// PRICE DATA
// ═══════════════════════════════════════════════════════════════

export interface PricePoint {
  ts: number;       // Unix timestamp ms
  price: number;    // Price in quote currency
  volume?: number;  // Optional volume
}

export interface PriceChartData {
  symbol: string;
  source: string;   // 'binance' | 'bybit' | 'coinbase'
  range: ChartRange;
  tf: ChartTimeframe;
  points: PricePoint[];
  meta: {
    start: number;
    end: number;
    count: number;
    lastPrice: number;
    priceChange: number;
    priceChangePercent: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// PREDICTION DATA
// ═══════════════════════════════════════════════════════════════

export interface PredictionPoint {
  ts: number;
  
  // Combined final prediction (price-like value)
  combined: number;
  combinedConfidence: number;
  
  // Layer scores (0-1 range, normalized)
  exchange: number;      // Exchange layer signal
  onchain: number;       // Onchain layer signal  
  sentiment: number;     // Sentiment layer signal
  
  // Direction
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface PredictionChartData {
  symbol: string;
  range: ChartRange;
  tf: ChartTimeframe;
  points: PredictionPoint[];
  meta: {
    avgConfidence: number;
    dominantDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    layerWeights: {
      exchange: number;
      onchain: number;
      sentiment: number;
    };
  };
}

// ═══════════════════════════════════════════════════════════════
// EVENT DATA
// ═══════════════════════════════════════════════════════════════

export type EventType = 'BUY' | 'SELL' | 'AVOID' | 'REGIME_CHANGE' | 'ALERT';

export interface ChartEvent {
  ts: number;
  type: EventType;
  confidence: number;
  note?: string;
  prevType?: EventType;
}

export interface EventChartData {
  symbol: string;
  range: ChartRange;
  events: ChartEvent[];
  meta: {
    totalEvents: number;
    buyCount: number;
    sellCount: number;
    avoidCount: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// COMBINED CHART RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface CentralChartData {
  symbol: string;
  range: ChartRange;
  tf: ChartTimeframe;
  
  price: PriceChartData;
  prediction: PredictionChartData;
  events: EventChartData;
  
  // Comparison metrics
  accuracy: {
    directionAccuracy: number;   // % of correct direction predictions
    avgDeviation: number;        // Average price deviation from prediction
    hitRate: number;             // % predictions within threshold
  };
}

console.log('[Chart] Types loaded');
