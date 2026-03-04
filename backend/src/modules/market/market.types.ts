/**
 * PHASE 1.2 — Market Module Types
 * ================================
 * 
 * Search + Asset Resolver types for market product layer.
 */

// ═══════════════════════════════════════════════════════════════
// DATA MODE
// ═══════════════════════════════════════════════════════════════

export type MarketDataMode = 'LIVE' | 'MOCK' | 'MIXED';

// ═══════════════════════════════════════════════════════════════
// SEARCH TYPES
// ═══════════════════════════════════════════════════════════════

export interface MarketSearchItem {
  symbol: string;       // ETHUSDT
  base: string;         // ETH
  quote: string;        // USDT
  exchanges: string[];  // ["BYBIT_USDTPERP", "BINANCE_USDM"]
  score?: number;       // Universe score
  inUniverse: boolean;  // Is in active universe
}

export interface MarketSearchResult {
  ok: boolean;
  items: MarketSearchItem[];
  query: string;
  normalized: string | null;
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════
// ASSET RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface MarketAssetAvailability {
  exchanges: string[];
  dataMode: MarketDataMode;
  providerUsed: string;
  inUniverse: boolean;
  reasons: string[];
}

export interface MarketAssetExchange {
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'NO_DATA';
  confidence: number;
  strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  drivers: string[];
  risks: string[];
}

export interface MarketAssetWhale {
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  impact: string;
  patterns: string[];
}

export interface MarketAssetStress {
  level: number;         // 0..1
  status: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NORMAL' | 'LOW';
  factors: string[];
}

export interface MarketAssetResponse {
  symbol: string;
  base: string;
  quote: string;
  
  availability: MarketAssetAvailability;
  
  exchange: MarketAssetExchange;
  whale: MarketAssetWhale;
  stress: MarketAssetStress;
  
  explainability: {
    drivers: string[];
    risks: string[];
    summary: string;
  };
  
  meta: {
    t0: string;
    version: string;
    processingMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// HISTORY TYPES (Phase 1.3)
// ═══════════════════════════════════════════════════════════════

export interface Candle {
  t: number;    // unix ms
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface VerdictPoint {
  t: number;
  layer: 'EXCHANGE' | 'META_BRAIN_V2';
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'INCONCLUSIVE' | 'NO_DATA';
  confidence: number;
}

export interface DivergenceMarker {
  t0: number;
  horizonMin: number;
  expectedDir: 'UP' | 'DOWN' | 'FLAT';
  realizedDir: 'UP' | 'DOWN' | 'FLAT';
  severity: number;
  reason: string;
}

export interface MarketHistoryResponse {
  symbol: string;
  window: {
    from: number;
    to: number;
    timeframe: string;
  };
  candles: Candle[];
  verdicts: VerdictPoint[];
  divergences: DivergenceMarker[];
  meta: {
    t0: string;
    dataMode: MarketDataMode;
    provider: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// BACKFILL TYPES (Phase 1.4)
// ═══════════════════════════════════════════════════════════════

export interface MarketHistoryPoint {
  symbol: string;
  t0: Date;
  
  price: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  };
  
  exchangeVerdict?: {
    verdict: string;
    confidence: number;
  };
  
  metaBrainVerdict?: {
    verdict: string;
    confidence: number;
  };
  
  realized?: {
    horizonMin: number;
    direction: 'UP' | 'DOWN' | 'FLAT';
    returnPct: number;
  };
  
  divergence?: {
    isDivergent: boolean;
    severity: number;
    reason?: string;
  };
  
  sourceMeta: {
    provider: string;
    dataMode: MarketDataMode;
  };
}

export interface MarketBackfillResult {
  symbol: string;
  pointsCreated: number;
  timeRange: {
    from: number;
    to: number;
  };
  stats: {
    divergenceRate: number;
    avgConfidence: number;
  };
}

console.log('[Phase 1.2] Market Types loaded');
