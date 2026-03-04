/**
 * Phase R: Pattern Types
 * Common types for all pattern detectors
 */

export interface Candle {
  t: number;  // timestamp
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v?: number; // volume
}

export interface PatternInput {
  asset: string;
  timeframe: string;
  candles: Candle[];
  pivots?: Pivot[];
  levels?: number[];
  indicators?: {
    rsi?: number[];
    macd?: number[];
    atr?: number[];
    ma20?: number[];
    ma50?: number[];
    ma200?: number[];
  };
}

export interface PatternResult {
  type: string;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  confidence: number;
  startIndex: number;
  endIndex: number;
  priceLevels?: number[];
  meta?: Record<string, any>;
}

export interface Pivot {
  index: number;
  price: number;
  kind: 'HIGH' | 'LOW';
  strength?: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Line {
  a: number;  // slope
  b: number;  // intercept (y = ax + b)
}
