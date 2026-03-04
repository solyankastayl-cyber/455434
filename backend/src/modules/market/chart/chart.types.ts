/**
 * PHASE 1.3 — Chart Types
 * ========================
 * 
 * Types for market chart with verdicts and divergence markers.
 */

// ═══════════════════════════════════════════════════════════════
// PRICE DATA
// ═══════════════════════════════════════════════════════════════

export interface MarketPriceBar {
  ts: number;      // candle open time (unix ms)
  o: number;       // open
  h: number;       // high
  l: number;       // low
  c: number;       // close
  v?: number;      // volume
}

// ═══════════════════════════════════════════════════════════════
// VERDICT HISTORY
// ═══════════════════════════════════════════════════════════════

export type VerdictLabel = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'INCONCLUSIVE' | 'NO_DATA';
export type VerdictSource = 'EXCHANGE' | 'META_BRAIN';

export interface VerdictPoint {
  ts: number;            // decision time
  verdict: VerdictLabel;
  confidence: number;    // 0..1
  source: VerdictSource;
  strength?: string;     // STRONG, WEAK, etc.
}

// ═══════════════════════════════════════════════════════════════
// DIVERGENCE
// ═══════════════════════════════════════════════════════════════

export type PriceDirection = 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';

export interface DivergenceEvent {
  ts: number;               // verdict time
  verdict: VerdictLabel;
  expectedMove: PriceDirection;
  actualMove: PriceDirection;
  magnitude: number;        // abs(return)
  horizonBars: number;      // how many bars forward
  reason: string;           // e.g. "BULLISH_but_price_DOWN"
}

// ═══════════════════════════════════════════════════════════════
// CHART RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface ChartDataResponse {
  symbol: string;
  timeframe: string;
  window: {
    from: number;
    to: number;
  };
  
  price: MarketPriceBar[];
  verdicts: VerdictPoint[];
  divergences: DivergenceEvent[];
  
  stats: {
    priceCount: number;
    verdictCount: number;
    divergenceCount: number;
    divergenceRate: number;
  };
  
  meta: {
    t0: string;
    provider: string;
    dataMode: 'LIVE' | 'MOCK' | 'CACHED';
  };
}

console.log('[Phase 1.3] Chart Types loaded');
