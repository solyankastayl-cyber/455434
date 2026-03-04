/**
 * S10 — Exchange Provider Types
 * 
 * Unified contracts for multi-exchange integration.
 * Provider = sensor, not brain.
 * Analytics NEVER know which exchange data comes from.
 */

// ═══════════════════════════════════════════════════════════════
// PROVIDER HEALTH & STATUS
// ═══════════════════════════════════════════════════════════════

export type ProviderStatus = 'STABLE' | 'DEGRADED' | 'DOWN' | 'INITIALIZING';

export interface ProviderHealth {
  status: ProviderStatus;
  lastSuccessfulFetch: number;
  lastError: string | null;
  errorCount: number;
  rateLimitRemaining: number;
  rateLimitResetAt: number;
  wsConnected: boolean;
  cacheHitRate: number;
}

// ═══════════════════════════════════════════════════════════════
// SYMBOL NORMALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Internal symbol format: BTCUSDT (no -PERP, -SWAP, _PERP, USDTM)
 * Provider-specific formats are handled by normalizeSymbol/denormalizeSymbol
 */
export type InternalSymbol = string; // e.g., "BTCUSDT", "ETHUSDT"

export interface SymbolInfo {
  internal: InternalSymbol;       // Our format: BTCUSDT
  provider: string;               // Provider format: BTC-USDT-SWAP (OKX)
  base: string;                   // BTC
  quote: string;                  // USDT
  type: 'SPOT' | 'PERP' | 'FUTURE';
  contractSize: number;
  tickSize: number;
  minQty: number;
}

// ═══════════════════════════════════════════════════════════════
// MARKET DATA SNAPSHOTS (NORMALIZED CONTRACTS)
// ═══════════════════════════════════════════════════════════════

export interface MarketSnapshot {
  symbol: InternalSymbol;
  provider: string;
  timestamp: number;
  
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  
  bid: number;
  ask: number;
  spread: number;
  
  volume24h: number;
  volumeQuote24h: number;
  
  high24h: number;
  low24h: number;
  change24h: number;
  changePct24h: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookSnapshot {
  symbol: InternalSymbol;
  provider: string;
  timestamp: number;
  
  bids: OrderBookLevel[];  // Sorted descending (best first)
  asks: OrderBookLevel[];  // Sorted ascending (best first)
  
  bidDepth: number;        // Total bid volume
  askDepth: number;        // Total ask volume
  imbalance: number;       // (bidDepth - askDepth) / (bidDepth + askDepth)
}

export interface Trade {
  id: string;
  symbol: InternalSymbol;
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
  isLiquidation: boolean;
}

export interface TradeFlowSnapshot {
  symbol: InternalSymbol;
  provider: string;
  timestamp: number;
  windowMs: number;
  
  trades: Trade[];
  buyVolume: number;
  sellVolume: number;
  buyCount: number;
  sellCount: number;
  netFlow: number;         // buyVolume - sellVolume
  aggressorBias: number;   // netFlow / totalVolume (-1 to +1)
}

export interface OpenInterestSnapshot {
  symbol: InternalSymbol;
  provider: string;
  timestamp: number;
  
  openInterest: number;          // Contracts
  openInterestValue: number;     // USD value
  oiDelta: number;               // Change since last
  oiDeltaPct: number;
}

export interface FundingSnapshot {
  symbol: InternalSymbol;
  provider: string;
  timestamp: number;
  
  fundingRate: number;           // Current rate
  nextFundingTime: number;       // Next funding timestamp
  predictedFundingRate: number;  // If available
  fundingInterval: number;       // ms between funding
}

export interface LiquidationEvent {
  symbol: InternalSymbol;
  provider: string;
  timestamp: number;
  
  side: 'LONG' | 'SHORT';
  price: number;
  quantity: number;
  value: number;
}

export interface LiquidationsSnapshot {
  symbol: InternalSymbol;
  provider: string;
  timestamp: number;
  windowMs: number;
  
  events: LiquidationEvent[];
  longLiquidations: number;
  shortLiquidations: number;
  totalValue: number;
  netBias: number;  // (short - long) / total
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volumeQuote: number;
}

export interface CandlesSnapshot {
  symbol: InternalSymbol;
  provider: string;
  timeframe: string;  // 1m, 5m, 15m, 1h, 4h, 1d
  candles: Candle[];
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER CAPABILITY MAP
// ═══════════════════════════════════════════════════════════════

export interface ProviderCapabilities {
  name: string;
  displayName: string;
  
  // Data sources
  hasTicker: boolean;
  hasOrderBook: boolean;
  hasTrades: boolean;
  hasOpenInterest: boolean;
  hasFunding: boolean;
  hasLiquidations: boolean;
  hasCandles: boolean;
  
  // WebSocket support
  wsTickerStream: boolean;
  wsOrderBookStream: boolean;
  wsTradesStream: boolean;
  wsLiquidationsStream: boolean;
  
  // Market types
  supportsSpot: boolean;
  supportsPerp: boolean;
  supportsFutures: boolean;
  
  // Limits
  maxRequestsPerMinute: number;
  maxWebSocketConnections: number;
  orderBookMaxDepth: number;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER INTERFACE (ALL EXCHANGES IMPLEMENT THIS)
// ═══════════════════════════════════════════════════════════════

export interface ExchangeProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  
  // Health & Status
  getHealth(): ProviderHealth;
  
  // Symbol management
  normalizeSymbol(internal: InternalSymbol): string;
  denormalizeSymbol(provider: string): InternalSymbol;
  getSymbolInfo(symbol: InternalSymbol): Promise<SymbolInfo | null>;
  getAvailableSymbols(): Promise<InternalSymbol[]>;
  
  // Market data (polling)
  getTicker(symbol: InternalSymbol): Promise<MarketSnapshot | null>;
  getOrderBook(symbol: InternalSymbol, depth?: number): Promise<OrderBookSnapshot | null>;
  getTrades(symbol: InternalSymbol, since?: number, limit?: number): Promise<Trade[]>;
  getOpenInterest(symbol: InternalSymbol): Promise<OpenInterestSnapshot | null>;
  getFunding(symbol: InternalSymbol): Promise<FundingSnapshot | null>;
  getLiquidations(symbol: InternalSymbol, since?: number): Promise<LiquidationEvent[]>;
  getCandles(symbol: InternalSymbol, timeframe: string, since?: number, limit?: number): Promise<Candle[]>;
  
  // WebSocket subscriptions
  subscribeToTicker(symbol: InternalSymbol, callback: (data: MarketSnapshot) => void): void;
  subscribeToOrderBook(symbol: InternalSymbol, callback: (data: OrderBookSnapshot) => void): void;
  subscribeToTrades(symbol: InternalSymbol, callback: (data: Trade) => void): void;
  subscribeToLiquidations(symbol: InternalSymbol, callback: (data: LiquidationEvent) => void): void;
  unsubscribe(symbol: InternalSymbol, channel: string): void;
  
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER REGISTRY
// ═══════════════════════════════════════════════════════════════

export interface ProviderConfig {
  name: string;
  enabled: boolean;
  priority: number;           // Lower = higher priority
  trackedSymbols: InternalSymbol[];
  pollIntervals: {
    ticker: number;           // ms
    orderBook: number;
    openInterest: number;
    funding: number;
    candles: number;
    liquidations: number;
  };
  wsEnabled: boolean;
}

export interface ProviderRegistryEntry {
  provider: ExchangeProvider;
  config: ProviderConfig;
  health: ProviderHealth;
}

console.log('[S10.P0] Exchange Provider Types loaded');
