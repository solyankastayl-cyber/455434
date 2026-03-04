/**
 * PHASE 1 — Market Cache Types
 * ==============================
 * 
 * Types for in-memory market data cache.
 */

// ═══════════════════════════════════════════════════════════════
// CANDLE
// ═══════════════════════════════════════════════════════════════

export interface Candle {
  t: number;      // timestamp (open time)
  o: number;      // open
  h: number;      // high
  l: number;      // low
  c: number;      // close
  v: number;      // volume
  closed: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ORDERBOOK
// ═══════════════════════════════════════════════════════════════

export interface OrderbookLevel {
  p: number;      // price
  q: number;      // quantity
}

export interface OrderbookSnapshot {
  symbol: string;
  ts: number;
  lastUpdateId: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  ready: boolean;
  mid?: number;
}

// ═══════════════════════════════════════════════════════════════
// LIQUIDATION
// ═══════════════════════════════════════════════════════════════

export interface Liquidation {
  ts: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  notional: number;
}

// ═══════════════════════════════════════════════════════════════
// DERIVATIVES (OI, Funding)
// ═══════════════════════════════════════════════════════════════

export interface DerivativesData {
  symbol: string;
  ts: number;
  openInterest: number;
  openInterestValue: number;
  fundingRate: number;
  nextFundingTime: number;
}

// ═══════════════════════════════════════════════════════════════
// CACHE STATUS
// ═══════════════════════════════════════════════════════════════

export interface CacheStatus {
  symbol: string;
  candlesCount: number;
  candlesLastTs?: number;
  orderbookReady: boolean;
  orderbookLastTs?: number;
  liquidationsCount: number;
  derivativesLastTs?: number;
  provider: string;
  dataMode: 'LIVE' | 'MOCK' | 'STALE';
}

console.log('[Phase 1] Market Cache Types loaded');
