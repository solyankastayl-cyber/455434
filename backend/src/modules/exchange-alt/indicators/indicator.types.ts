/**
 * INDICATOR ENGINE — Types & Interfaces
 * =======================================
 * 
 * Extensible indicator calculation system for Alt Scanner.
 */

import type { MarketOHLCV, DerivativesSnapshot, IndicatorVector, Timeframe } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// INDICATOR PROVIDER INTERFACE
// ═══════════════════════════════════════════════════════════════

export type IndicatorCategory = 
  | 'MOMENTUM'
  | 'TREND'
  | 'VOLATILITY'
  | 'VOLUME'
  | 'DERIVATIVES'
  | 'STRUCTURE';

export interface IndicatorInput {
  symbol: string;
  candles: MarketOHLCV[];
  derivatives?: DerivativesSnapshot;
  ticker?: {
    lastPrice: number;
    volume24h: number;
  };
  timeframe: Timeframe;
}

export interface IndicatorOutput {
  key: string;
  value: number | boolean | string;
  normalized?: number;  // -1 to +1 or 0 to 1
  zScore?: number;
  confidence: number;   // 0 to 1
}

export interface IIndicatorProvider {
  readonly id: string;
  readonly category: IndicatorCategory;
  readonly requiredCandles: number;
  readonly indicators: string[];
  
  calculate(input: IndicatorInput): Promise<IndicatorOutput[]>;
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR REGISTRY
// ═══════════════════════════════════════════════════════════════

export interface IndicatorProviderEntry {
  provider: IIndicatorProvider;
  enabled: boolean;
  weight: number;
}

export interface IndicatorEngineConfig {
  minCandlesRequired: number;
  defaultTimeframe: Timeframe;
  parallelProviders: number;
  timeoutMs: number;
}

export const DEFAULT_ENGINE_CONFIG: IndicatorEngineConfig = {
  minCandlesRequired: 50,
  defaultTimeframe: '1h',
  parallelProviders: 5,
  timeoutMs: 10000,
};

// ═══════════════════════════════════════════════════════════════
// VECTOR BUILDER TYPES
// ═══════════════════════════════════════════════════════════════

export interface VectorBuildResult {
  vector: Partial<IndicatorVector>;
  missing: string[];
  coverage: number;
  providers: {
    id: string;
    success: boolean;
    error?: string;
    durationMs: number;
  }[];
}

export interface BatchVectorResult {
  vectors: Map<string, IndicatorVector>;
  errors: Map<string, string>;
  stats: {
    total: number;
    success: number;
    failed: number;
    avgCoverage: number;
    durationMs: number;
  };
}

console.log('[ExchangeAlt] Indicator types loaded');
