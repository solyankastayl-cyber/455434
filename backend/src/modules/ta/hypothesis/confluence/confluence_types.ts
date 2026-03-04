/**
 * Phase C: Confluence Types
 * 
 * ARCHITECTURAL RULE:
 * Confluence factors are INDEPENDENT scoring dimensions.
 * Each factor returns 0..1 value with weight.
 * Final score = base * aggregate(factors)
 * 
 * This prevents "rule explosion" - no arbitrary if-then-else chains.
 */

export type FactorResult = {
  name: string;
  value: number;      // 0..1 (normalized score)
  weight: number;     // 0..1 (importance)
  multiplier?: number; // optional gate (volatility, etc)
  reason: string[];   // explainability
};

export type ConfluenceResult = {
  baseScore: number;
  factors: FactorResult[];
  weightedSum: number;
  totalWeight: number;
  confluenceScore: number;  // 0..1 aggregate
  finalScore: number;       // base * confluence (or with gates)
  reasons: string[];
};

export type MarketContext = {
  // Structure/Regime
  regime: 'UP' | 'DOWN' | 'SIDEWAYS' | 'TRANSITION';
  hhhlScore?: number;
  compressionScore?: number;
  
  // MA Context
  maTrend?: 'BULL' | 'BEAR' | 'MIXED' | 'FLAT';
  ma50Slope?: number;
  ma200Slope?: number;
  priceVsMa50?: number;
  priceVsMa200?: number;
  
  // Fibonacci Context
  nearestFib?: 'golden' | 'major' | 'minor' | 'weak' | 'none';
  fibDistance?: number;
  
  // Volatility Context
  volatility: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  atrPercentile?: number;
  
  // Signal Confirmations
  rsiDivergence?: boolean;
  macdDivergence?: boolean;
  candleSignal?: string;
  breakout?: boolean;
  retest?: boolean;
  
  // Current price for R:R calculation
  currentPrice?: number;
};

export type PatternInput = {
  type: string;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL' | 'BOTH';
  score: number;
  metrics?: {
    symmetry?: number;
    compression?: number;
    touches?: number;
    touchesUpper?: number;
    touchesLower?: number;
    slope?: number;
    rr?: number;
    geometryScore?: number;
    touchScore?: number;
    noiseScore?: number;
    [key: string]: any;
  };
  trade?: {
    entry?: number;
    stop?: number;
    target1?: number;
    target2?: number;
  };
};
