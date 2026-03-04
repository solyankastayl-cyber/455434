/**
 * B3 — Market Context Types
 * 
 * Types for Market Context Builder.
 * Aggregated market state for each symbol.
 */

export type ReadinessStatus = 'READY' | 'DEGRADED' | 'NO_DATA';
export type WhaleRiskBucket = 'LOW' | 'MID' | 'HIGH';
export type MarketBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface MarketAxes {
  /** Momentum state: -1..+1 */
  momentum: number;
  /** Structure state: -1..+1 */
  structure: number;
  /** Participation: 0..1 */
  participation: number;
  /** Orderbook pressure: -1..+1 (positive = bids dominate) */
  orderbookPressure: number;
  /** Position crowding: 0..1 */
  positioning: number;
  /** Market stress: 0..1 */
  marketStress: number;
}

export interface MarketAxesDrivers {
  momentum: string[];
  structure: string[];
  participation: string[];
  orderbookPressure: string[];
  positioning: string[];
  marketStress: string[];
}

export interface RegimeInfo {
  type: string;
  confidence: number;
  source: 'indicator' | 'legacy' | 'dual';
  drivers?: string[];
}

export interface PatternInfo {
  id: string;
  confidence: number;
  stabilityTicks: number;
}

export interface WhaleRiskInfo {
  bucket: WhaleRiskBucket;
  lift?: number;
  activePattern?: string | null;
  netBias?: number;
  maxPositionUsd?: number;
}

export interface ReadinessInfo {
  status: ReadinessStatus;
  score: number;
  reasons: string[];
}

export interface ContextRefs {
  lastIndicatorsAt?: string;
  lastOrderbookAt?: string;
  lastOiAt?: string;
  lastWhalesAt?: string;
}

export interface MarketContext {
  symbol: string;
  exchange: string;
  
  /** 6 aggregated axes */
  axes: MarketAxes;
  
  /** Drivers for each axis */
  drivers: MarketAxesDrivers;
  
  /** Current regime */
  regime?: RegimeInfo;
  
  /** Active patterns */
  patterns: PatternInfo[];
  
  /** Whale risk context */
  whaleRisk: WhaleRiskInfo;
  
  /** Readiness / data quality */
  readiness: ReadinessInfo;
  
  /** Data source timestamps */
  refs: ContextRefs;
  
  /** Universe score (from B2) */
  universeScore: number;
  
  updatedAt: string;
}

export interface MarketContextDebug extends MarketContext {
  debug: {
    rawIndicatorCount: number;
    regimeSource: string;
    patternSource: string;
    whaleDataAge: number;
  };
}

console.log('[B3] Context Types loaded');
