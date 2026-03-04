/**
 * S10.1 — Exchange Data Contracts (LOCKED)
 * 
 * These contracts define the exchange reality layer.
 * DO NOT MODIFY once S10.1 is complete.
 * 
 * Principles:
 * - No ML, no signals, no decisions
 * - Only market facts
 * - Real-time data
 */

// ═══════════════════════════════════════════════════════════════
// MARKET SNAPSHOT
// ═══════════════════════════════════════════════════════════════
export interface ExchangeMarketSnapshot {
  symbol: string;
  price: number;
  change24h: number;        // percentage
  volume24h: number;        // in quote currency
  volatility: number;       // 0-1 normalized
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════
// ORDER BOOK SNAPSHOT
// ═══════════════════════════════════════════════════════════════
export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  bids: OrderBookLevel[];   // buy orders
  asks: OrderBookLevel[];   // sell orders
  spread: number;           // ask - bid (percentage)
  imbalance: number;        // -1 to 1 (negative = sell pressure)
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════
// TRADE FLOW SNAPSHOT
// ═══════════════════════════════════════════════════════════════
export interface TradeFlowSnapshot {
  symbol: string;
  buyVolume: number;        // volume from buy trades
  sellVolume: number;       // volume from sell trades
  aggressorRatio: number;   // -1 to 1 (positive = buyers aggressive)
  window: string;           // '1m' | '5m' | '15m' | '1h'
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════
// OPEN INTEREST SNAPSHOT
// ═══════════════════════════════════════════════════════════════
export interface OpenInterestSnapshot {
  symbol: string;
  oi: number;               // total open interest
  oiChange: number;         // change percentage
  fundingRate: number;      // current funding rate
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════
// LIQUIDATION EVENT
// ═══════════════════════════════════════════════════════════════
export type LiquidationSide = 'LONG' | 'SHORT';

export interface LiquidationEvent {
  symbol: string;
  side: LiquidationSide;
  size: number;             // liquidation size in quote
  price: number;            // liquidation price
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════
// MARKET REGIME (placeholder for S10.2+)
// ═══════════════════════════════════════════════════════════════
export type MarketRegime = 
  | 'UNKNOWN'
  | 'LOW_ACTIVITY'
  | 'TRENDING'
  | 'SQUEEZE'
  | 'DISTRIBUTION';

// ═══════════════════════════════════════════════════════════════
// EXCHANGE OVERVIEW (aggregated state)
// ═══════════════════════════════════════════════════════════════
export interface ExchangeOverview {
  regime: MarketRegime;
  volatilityIndex: number;        // 0-100
  aggressionRatio: number;        // -1 to 1
  oiTrend: 'EXPANDING' | 'CONTRACTING' | 'NEUTRAL';
  liquidationPressure: number;    // 0-100
  lastUpdate: Date;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER STATUS
// ═══════════════════════════════════════════════════════════════
export interface ExchangeProviderStatus {
  provider: string;
  status: 'OK' | 'DEGRADED' | 'DOWN';
  lastUpdate: Date;
  errorCount: number;
  rateLimitUsed: number;          // percentage
  latencyMs: number;
}

// ═══════════════════════════════════════════════════════════════
// EXCHANGE CONFIG
// ═══════════════════════════════════════════════════════════════
export interface ExchangeConfig {
  enabled: boolean;
  pollingIntervalMs: number;
  symbols: string[];
  provider: string;
}
