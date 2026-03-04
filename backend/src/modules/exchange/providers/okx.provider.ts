/**
 * S10 — OKX Exchange Provider
 * 
 * Primary provider for derivatives data.
 * Implements unified ExchangeProvider interface.
 * 
 * Symbol mapping:
 * - Internal: BTCUSDT
 * - OKX: BTC-USDT-SWAP
 */

import { BaseExchangeProvider } from './base.provider.js';
import {
  ProviderCapabilities,
  InternalSymbol,
  SymbolInfo,
  MarketSnapshot,
  OrderBookSnapshot,
  OrderBookLevel,
  Trade,
  OpenInterestSnapshot,
  FundingSnapshot,
  LiquidationEvent,
  Candle,
} from './provider.types.js';

// ═══════════════════════════════════════════════════════════════
// OKX API TYPES
// ═══════════════════════════════════════════════════════════════

interface OKXTickerResponse {
  code: string;
  data: Array<{
    instId: string;
    last: string;
    lastSz: string;
    askPx: string;
    askSz: string;
    bidPx: string;
    bidSz: string;
    open24h: string;
    high24h: string;
    low24h: string;
    volCcy24h: string;
    vol24h: string;
    ts: string;
  }>;
}

interface OKXOrderBookResponse {
  code: string;
  data: Array<{
    asks: string[][];  // [price, size, liquidated_orders, num_orders]
    bids: string[][];
    ts: string;
  }>;
}

interface OKXTradeResponse {
  code: string;
  data: Array<{
    instId: string;
    tradeId: string;
    px: string;
    sz: string;
    side: string;
    ts: string;
  }>;
}

interface OKXOpenInterestResponse {
  code: string;
  data: Array<{
    instId: string;
    instType: string;
    oi: string;
    oiCcy: string;
    ts: string;
  }>;
}

interface OKXFundingRateResponse {
  code: string;
  data: Array<{
    instId: string;
    fundingRate: string;
    nextFundingRate: string;
    fundingTime: string;
    nextFundingTime: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// OKX PROVIDER
// ═══════════════════════════════════════════════════════════════

export class OKXProvider extends BaseExchangeProvider {
  readonly name = 'OKX';
  
  readonly capabilities: ProviderCapabilities = {
    name: 'okx',
    displayName: 'OKX',
    hasTicker: true,
    hasOrderBook: true,
    hasTrades: true,
    hasOpenInterest: true,
    hasFunding: true,
    hasLiquidations: true,
    hasCandles: true,
    wsTickerStream: true,
    wsOrderBookStream: true,
    wsTradesStream: true,
    wsLiquidationsStream: true,
    supportsSpot: true,
    supportsPerp: true,
    supportsFutures: true,
    maxRequestsPerMinute: 60,
    maxWebSocketConnections: 3,
    orderBookMaxDepth: 400,
  };
  
  private baseUrl = 'https://www.okx.com';
  private previousOI: Map<string, number> = new Map();
  
  constructor() {
    // OKX rate limit: 20 requests per 2 seconds per endpoint
    super({ maxRequests: 60, windowMs: 60000 });
  }
  
  // ─────────────────────────────────────────────────────────────
  // Symbol Normalization
  // ─────────────────────────────────────────────────────────────
  
  normalizeSymbol(internal: InternalSymbol): string {
    // BTCUSDT -> BTC-USDT-SWAP
    const base = internal.replace('USDT', '');
    return `${base}-USDT-SWAP`;
  }
  
  denormalizeSymbol(provider: string): InternalSymbol {
    // BTC-USDT-SWAP -> BTCUSDT
    const match = provider.match(/^([A-Z]+)-USDT-(SWAP|PERP)/);
    if (match) {
      return `${match[1]}USDT`;
    }
    // Fallback: try to extract
    return provider.replace(/-USDT.*/, 'USDT');
  }
  
  async getSymbolInfo(symbol: InternalSymbol): Promise<SymbolInfo | null> {
    const providerSymbol = this.normalizeSymbol(symbol);
    const base = symbol.replace('USDT', '');
    
    return {
      internal: symbol,
      provider: providerSymbol,
      base,
      quote: 'USDT',
      type: 'PERP',
      contractSize: 1,
      tickSize: 0.1,
      minQty: 0.001,
    };
  }
  
  async getAvailableSymbols(): Promise<InternalSymbol[]> {
    // Return commonly tracked symbols
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT'];
  }
  
  // ─────────────────────────────────────────────────────────────
  // HTTP Request Helper
  // ─────────────────────────────────────────────────────────────
  
  private async fetchOKX<T>(endpoint: string): Promise<T | null> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json() as any;
      
      if (data.code !== '0') {
        throw new Error(`OKX Error: ${data.msg || data.code}`);
      }
      
      return data as T;
    } catch (error: any) {
      console.error(`[OKX] Fetch error for ${endpoint}: ${error.message}`);
      throw error;
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Market Data Implementation
  // ─────────────────────────────────────────────────────────────
  
  async getTicker(symbol: InternalSymbol): Promise<MarketSnapshot | null> {
    const cacheKey = `ticker:${symbol}`;
    const providerSymbol = this.normalizeSymbol(symbol);
    
    return this.rateLimitedFetch(cacheKey, this.cacheTTL.ticker, async () => {
      const response = await this.fetchOKX<OKXTickerResponse>(
        `/api/v5/market/ticker?instId=${providerSymbol}`
      );
      
      if (!response || !response.data || response.data.length === 0) {
        return null;
      }
      
      const ticker = response.data[0];
      const lastPrice = parseFloat(ticker.last);
      const open24h = parseFloat(ticker.open24h);
      const change24h = lastPrice - open24h;
      
      return {
        symbol,
        provider: this.name,
        timestamp: parseInt(ticker.ts),
        lastPrice,
        markPrice: lastPrice, // OKX ticker doesn't include mark price
        indexPrice: lastPrice,
        bid: parseFloat(ticker.bidPx),
        ask: parseFloat(ticker.askPx),
        spread: parseFloat(ticker.askPx) - parseFloat(ticker.bidPx),
        volume24h: parseFloat(ticker.vol24h),
        volumeQuote24h: parseFloat(ticker.volCcy24h),
        high24h: parseFloat(ticker.high24h),
        low24h: parseFloat(ticker.low24h),
        change24h,
        changePct24h: open24h > 0 ? (change24h / open24h) * 100 : 0,
      };
    });
  }
  
  async getOrderBook(symbol: InternalSymbol, depth: number = 20): Promise<OrderBookSnapshot | null> {
    const cacheKey = `orderbook:${symbol}:${depth}`;
    const providerSymbol = this.normalizeSymbol(symbol);
    
    return this.rateLimitedFetch(cacheKey, this.cacheTTL.orderBook, async () => {
      const response = await this.fetchOKX<OKXOrderBookResponse>(
        `/api/v5/market/books?instId=${providerSymbol}&sz=${depth}`
      );
      
      if (!response || !response.data || response.data.length === 0) {
        return null;
      }
      
      const book = response.data[0];
      
      const bids: OrderBookLevel[] = book.bids.map(b => ({
        price: parseFloat(b[0]),
        quantity: parseFloat(b[1]),
      }));
      
      const asks: OrderBookLevel[] = book.asks.map(a => ({
        price: parseFloat(a[0]),
        quantity: parseFloat(a[1]),
      }));
      
      const bidDepth = bids.reduce((sum, b) => sum + b.quantity, 0);
      const askDepth = asks.reduce((sum, a) => sum + a.quantity, 0);
      const totalDepth = bidDepth + askDepth;
      
      return {
        symbol,
        provider: this.name,
        timestamp: parseInt(book.ts),
        bids,
        asks,
        bidDepth,
        askDepth,
        imbalance: totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0,
      };
    });
  }
  
  async getTrades(symbol: InternalSymbol, since?: number, limit: number = 100): Promise<Trade[]> {
    const cacheKey = `trades:${symbol}:${since}:${limit}`;
    const providerSymbol = this.normalizeSymbol(symbol);
    
    const result = await this.rateLimitedFetch(cacheKey, this.cacheTTL.trades, async () => {
      const response = await this.fetchOKX<OKXTradeResponse>(
        `/api/v5/market/trades?instId=${providerSymbol}&limit=${limit}`
      );
      
      if (!response || !response.data) {
        return [];
      }
      
      return response.data.map(t => ({
        id: t.tradeId,
        symbol,
        price: parseFloat(t.px),
        quantity: parseFloat(t.sz),
        side: t.side.toUpperCase() as 'BUY' | 'SELL',
        timestamp: parseInt(t.ts),
        isLiquidation: false,
      }));
    });
    
    return result || [];
  }
  
  async getOpenInterest(symbol: InternalSymbol): Promise<OpenInterestSnapshot | null> {
    const cacheKey = `oi:${symbol}`;
    const providerSymbol = this.normalizeSymbol(symbol);
    
    return this.rateLimitedFetch(cacheKey, this.cacheTTL.openInterest, async () => {
      const response = await this.fetchOKX<OKXOpenInterestResponse>(
        `/api/v5/public/open-interest?instId=${providerSymbol}`
      );
      
      if (!response || !response.data || response.data.length === 0) {
        return null;
      }
      
      const oi = response.data[0];
      const openInterest = parseFloat(oi.oi);
      const openInterestValue = parseFloat(oi.oiCcy);
      
      // Calculate delta from previous
      const prevOI = this.previousOI.get(symbol) || openInterest;
      const oiDelta = openInterest - prevOI;
      const oiDeltaPct = prevOI > 0 ? (oiDelta / prevOI) * 100 : 0;
      
      this.previousOI.set(symbol, openInterest);
      
      return {
        symbol,
        provider: this.name,
        timestamp: parseInt(oi.ts),
        openInterest,
        openInterestValue,
        oiDelta,
        oiDeltaPct,
      };
    });
  }
  
  async getFunding(symbol: InternalSymbol): Promise<FundingSnapshot | null> {
    const cacheKey = `funding:${symbol}`;
    const providerSymbol = this.normalizeSymbol(symbol);
    
    return this.rateLimitedFetch(cacheKey, this.cacheTTL.funding, async () => {
      const response = await this.fetchOKX<OKXFundingRateResponse>(
        `/api/v5/public/funding-rate?instId=${providerSymbol}`
      );
      
      if (!response || !response.data || response.data.length === 0) {
        return null;
      }
      
      const funding = response.data[0];
      
      return {
        symbol,
        provider: this.name,
        timestamp: Date.now(),
        fundingRate: parseFloat(funding.fundingRate),
        nextFundingTime: parseInt(funding.nextFundingTime),
        predictedFundingRate: parseFloat(funding.nextFundingRate || funding.fundingRate),
        fundingInterval: 8 * 60 * 60 * 1000, // 8 hours
      };
    });
  }
  
  async getLiquidations(symbol: InternalSymbol, since?: number): Promise<LiquidationEvent[]> {
    // OKX doesn't have a public liquidations endpoint
    // Would need to use WebSocket for real-time liquidations
    return [];
  }
  
  async getCandles(
    symbol: InternalSymbol, 
    timeframe: string = '5m', 
    since?: number, 
    limit: number = 100
  ): Promise<Candle[]> {
    const cacheKey = `candles:${symbol}:${timeframe}:${since}:${limit}`;
    const providerSymbol = this.normalizeSymbol(symbol);
    
    // OKX timeframe mapping
    const tfMap: Record<string, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '1h': '1H',
      '4h': '4H',
      '1d': '1D',
    };
    
    const okxTf = tfMap[timeframe] || '5m';
    
    const result = await this.rateLimitedFetch(cacheKey, this.cacheTTL.candles, async () => {
      let url = `/api/v5/market/candles?instId=${providerSymbol}&bar=${okxTf}&limit=${limit}`;
      if (since) {
        url += `&after=${since}`;
      }
      
      const response = await fetch(`${this.baseUrl}${url}`);
      const data = await response.json() as any;
      
      if (data.code !== '0' || !data.data) {
        return [];
      }
      
      // OKX returns: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
      return data.data.map((c: string[]) => ({
        timestamp: parseInt(c[0]),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
        volumeQuote: parseFloat(c[6]),
      })).reverse(); // OKX returns newest first, we want oldest first
    });
    
    return result || [];
  }
  
  // ─────────────────────────────────────────────────────────────
  // WebSocket (placeholder for future implementation)
  // ─────────────────────────────────────────────────────────────
  
  async connect(): Promise<void> {
    await super.connect();
    console.log('[OKX] Provider ready (polling mode)');
  }
}

// Export singleton instance
export const okxProvider = new OKXProvider();

console.log('[S10.P0] OKX Provider loaded');
