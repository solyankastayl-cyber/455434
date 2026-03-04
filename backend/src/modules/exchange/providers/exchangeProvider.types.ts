/**
 * X1 — Exchange Provider Types
 * =============================
 * 
 * Universal contract for exchange data sources.
 * All providers normalize data to this format.
 * 
 * INVARIANTS:
 * - Providers are READ-ONLY
 * - No trading logic
 * - No S10 logic here
 * - Pure data fetching
 */

// ═══════════════════════════════════════════════════════════════
// PROVIDER IDENTIFICATION
// ═══════════════════════════════════════════════════════════════

export type ProviderId =
  | 'BINANCE_USDM'
  | 'BYBIT_USDTPERP'
  | 'COINBASE_PERP'
  | 'HYPERLIQUID'
  | 'MOCK';

export type ProviderStatus = 'UP' | 'DEGRADED' | 'DOWN';

// ═══════════════════════════════════════════════════════════════
// HEALTH & CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════

export interface ProviderHealth {
  id: ProviderId;
  status: ProviderStatus;
  errorStreak: number;
  lastOkAt?: number;
  lastErrorAt?: number;
  rateLimit?: {
    remaining?: number;
    resetAt?: number;
  };
  notes?: string[];
}

// ═══════════════════════════════════════════════════════════════
// MARKET DATA TYPES
// ═══════════════════════════════════════════════════════════════

export interface MarketSymbol {
  symbol: string;       // BTCUSDT
  base: string;         // BTC
  quote: string;        // USDT
  status: 'TRADING' | 'HALT';
  minQty?: number;
  tickSize?: number;
  contractType?: string;
}

export interface Candle {
  t: number;   // timestamp
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
}

export interface OrderBook {
  t: number;
  bids: [number, number][];  // [price, quantity]
  asks: [number, number][];
  mid: number;
}

export interface Trade {
  t: number;
  price: number;
  qty: number;
  side: 'BUY' | 'SELL';
  isBuyerMaker?: boolean;
}

export interface OISnapshot {
  t: number;
  openInterest: number;
  openInterestUsd?: number;
}

export interface FundingSnapshot {
  t: number;
  fundingRate: number;
  nextFundingTime?: number;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface IExchangeProvider {
  readonly id: ProviderId;

  /** Get provider health status */
  health(): Promise<ProviderHealth>;

  /** Get available symbols */
  getSymbols(): Promise<MarketSymbol[]>;

  /** Get OHLCV candles */
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;

  /** Get order book depth */
  getOrderBook(symbol: string, depth: number): Promise<OrderBook>;

  /** Get recent trades */
  getTrades(symbol: string, limit: number): Promise<Trade[]>;

  /** Get open interest (if available) */
  getOpenInterest(symbol: string): Promise<OISnapshot | null>;

  /** Get funding rate (if available) */
  getFunding(symbol: string): Promise<FundingSnapshot | null>;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER CONFIG
// ═══════════════════════════════════════════════════════════════

export interface ProviderConfig {
  enabled: boolean;
  priority: number;  // Higher = preferred
  timeoutMs?: number;
  retries?: number;
}

export interface ProviderEntry {
  provider: IExchangeProvider;
  config: ProviderConfig;
  health: ProviderHealth;
}

console.log('[X1] Exchange Provider Types loaded');
