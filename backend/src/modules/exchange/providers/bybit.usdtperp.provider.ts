/**
 * Z1 — Bybit USDT Perpetual Provider
 * ====================================
 * 
 * Primary data source for market data (Bybit handles more regions than Binance).
 * Uses centralized HTTP client with proxy support.
 * 
 * API: https://api.bybit.com/v5
 * Docs: https://bybit-exchange.github.io/docs/v5/intro
 * 
 * PRIORITY: 100 (higher than Binance's 90)
 * 
 * SUPPORTED:
 * - Candles (OHLCV)
 * - Order book
 * - Recent trades
 * - Open interest
 * - Funding rate
 */

import {
  IExchangeProvider,
  ProviderId,
  ProviderHealth,
  ProviderStatus,
  MarketSymbol,
  Candle,
  OrderBook,
  Trade,
  OISnapshot,
  FundingSnapshot,
} from './exchangeProvider.types.js';

import { createBybitClient } from '../../network/httpClient.factory.js';
import { AxiosInstance } from 'axios';

// ═══════════════════════════════════════════════════════════════
// HTTP CLIENT (lazy initialization)
// ═══════════════════════════════════════════════════════════════

let httpClient: AxiosInstance | null = null;

async function getClient(): Promise<AxiosInstance> {
  if (!httpClient) {
    httpClient = await createBybitClient();
  }
  return httpClient;
}

// Reset client (for proxy config changes)
export function resetBybitClient(): void {
  httpClient = null;
  console.log('[BybitUsdtPerp] HTTP client reset');
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function toNum(x: any): number {
  return Number(x) || 0;
}

// Map Bybit interval strings to our standard intervals
function mapInterval(interval: string): string {
  const mapping: Record<string, string> = {
    '1m': '1',
    '3m': '3',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '2h': '120',
    '4h': '240',
    '6h': '360',
    '12h': '720',
    '1d': 'D',
    '1w': 'W',
    '1M': 'M',
  };
  return mapping[interval] || interval;
}

// ═══════════════════════════════════════════════════════════════
// BYBIT PROVIDER CLASS
// ═══════════════════════════════════════════════════════════════

export class BybitUsdtPerpProvider implements IExchangeProvider {
  readonly id: ProviderId = 'BYBIT_USDTPERP';
  
  private category: 'linear' = 'linear';
  private errorStreak = 0;
  private lastOkAt?: number;
  private lastErrorAt?: number;
  private lastErrorMsg?: string;
  
  // Cache for symbols (refresh every 5 minutes)
  private symbolsCache: MarketSymbol[] | null = null;
  private symbolsCacheTime = 0;
  private SYMBOLS_CACHE_TTL = 5 * 60 * 1000;
  
  // ─────────────────────────────────────────────────────────────
  // HEALTH MANAGEMENT
  // ─────────────────────────────────────────────────────────────
  
  private recordSuccess(): void {
    this.errorStreak = 0;
    this.lastOkAt = Date.now();
    this.lastErrorMsg = undefined;
  }
  
  private recordError(err: Error | string): void {
    this.errorStreak++;
    this.lastErrorAt = Date.now();
    this.lastErrorMsg = err instanceof Error ? err.message : String(err);
  }
  
  private getStatus(): ProviderStatus {
    if (this.errorStreak >= 5) return 'DOWN';
    if (this.errorStreak >= 3) return 'DEGRADED';
    return 'UP';
  }
  
  async health(): Promise<ProviderHealth> {
    const notes: string[] = [];
    
    // Quick health check
    try {
      const client = await getClient();
      const response = await client.get('/v5/market/tickers', {
        params: { category: this.category, symbol: 'BTCUSDT' },
        timeout: 5000,
      });
      
      if (response.data?.retCode === 0) {
        this.recordSuccess();
      } else {
        this.recordError(`Bybit API error: ${response.data?.retMsg}`);
      }
    } catch (error: any) {
      const msg = error.response?.status 
        ? `HTTP ${error.response.status}` 
        : error.message || String(error);
      this.recordError(msg);
    }
    
    if (this.lastErrorMsg) {
      notes.push(`Last error: ${this.lastErrorMsg}`);
    }
    
    return {
      id: this.id,
      status: this.getStatus(),
      errorStreak: this.errorStreak,
      lastOkAt: this.lastOkAt,
      lastErrorAt: this.lastErrorAt,
      notes,
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // SYMBOLS
  // ─────────────────────────────────────────────────────────────
  
  async getSymbols(): Promise<MarketSymbol[]> {
    // Return cached if fresh
    if (this.symbolsCache && Date.now() - this.symbolsCacheTime < this.SYMBOLS_CACHE_TTL) {
      return this.symbolsCache;
    }
    
    try {
      const client = await getClient();
      const response = await client.get('/v5/market/instruments-info', {
        params: { category: this.category },
      });
      
      const data = response.data;
      
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg} (code: ${data.retCode})`);
      }
      
      const list = data?.result?.list ?? [];
      
      const symbols: MarketSymbol[] = list
        .filter((item: any) => item.status === 'Trading')
        .map((item: any) => ({
          symbol: String(item.symbol),
          base: String(item.baseCoin),
          quote: String(item.quoteCoin || 'USDT'),
          status: 'TRADING' as const,
          minQty: toNum(item.lotSizeFilter?.minOrderQty),
          tickSize: toNum(item.priceFilter?.tickSize),
          contractType: item.contractType,
        }));
      
      this.symbolsCache = symbols;
      this.symbolsCacheTime = Date.now();
      this.recordSuccess();
      
      return symbols;
    } catch (err: any) {
      this.recordError(err);
      return this.symbolsCache || [];
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // CANDLES
  // ─────────────────────────────────────────────────────────────
  
  async getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    try {
      const client = await getClient();
      const bybitInterval = mapInterval(interval);
      
      const response = await client.get('/v5/market/kline', {
        params: { category: this.category, symbol, interval: bybitInterval, limit },
      });
      
      const data = response.data;
      
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg} (code: ${data.retCode})`);
      }
      
      const rows = data?.result?.list ?? [];
      
      // Bybit returns: [startTime, open, high, low, close, volume, turnover]
      // Sorted DESC by default, we reverse for ASC
      const candles: Candle[] = rows
        .map((row: any[]) => ({
          t: toNum(row[0]),
          o: toNum(row[1]),
          h: toNum(row[2]),
          l: toNum(row[3]),
          c: toNum(row[4]),
          v: toNum(row[5]),
        }))
        .sort((a: Candle, b: Candle) => a.t - b.t);
      
      this.recordSuccess();
      return candles;
    } catch (err: any) {
      this.recordError(err);
      throw err;
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // ORDER BOOK
  // ─────────────────────────────────────────────────────────────
  
  async getOrderBook(symbol: string, depth: number): Promise<OrderBook> {
    try {
      const client = await getClient();
      // Bybit supports depths: 1, 50, 200, 500
      const validDepth = depth <= 1 ? 1 : depth <= 50 ? 50 : depth <= 200 ? 200 : 500;
      
      const response = await client.get('/v5/market/orderbook', {
        params: { category: this.category, symbol, limit: validDepth },
      });
      
      const data = response.data;
      
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg} (code: ${data.retCode})`);
      }
      
      const result = data?.result;
      if (!result) {
        throw new Error('No orderbook data');
      }
      
      const bids: [number, number][] = (result.b ?? []).map((item: string[]) => [
        toNum(item[0]),
        toNum(item[1]),
      ]);
      
      const asks: [number, number][] = (result.a ?? []).map((item: string[]) => [
        toNum(item[0]),
        toNum(item[1]),
      ]);
      
      const bestBid = bids[0]?.[0] ?? 0;
      const bestAsk = asks[0]?.[0] ?? 0;
      const mid = (bestBid + bestAsk) / 2;
      
      this.recordSuccess();
      
      return {
        t: toNum(result.ts) || Date.now(),
        bids,
        asks,
        mid,
      };
    } catch (err: any) {
      this.recordError(err);
      throw err;
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // TRADES
  // ─────────────────────────────────────────────────────────────
  
  async getTrades(symbol: string, limit: number): Promise<Trade[]> {
    try {
      const client = await getClient();
      
      const response = await client.get('/v5/market/recent-trade', {
        params: { category: this.category, symbol, limit },
      });
      
      const data = response.data;
      
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg} (code: ${data.retCode})`);
      }
      
      const list = data?.result?.list ?? [];
      
      const trades: Trade[] = list.map((item: any) => ({
        t: toNum(item.time),
        price: toNum(item.price),
        qty: toNum(item.size),
        side: String(item.side).toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
        isBuyerMaker: item.side === 'Sell', // In Bybit, if side=Sell, buyer was maker
      }));
      
      this.recordSuccess();
      return trades;
    } catch (err: any) {
      this.recordError(err);
      throw err;
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // OPEN INTEREST
  // ─────────────────────────────────────────────────────────────
  
  async getOpenInterest(symbol: string): Promise<OISnapshot | null> {
    try {
      const client = await getClient();
      
      const response = await client.get('/v5/market/open-interest', {
        params: { category: this.category, symbol, intervalTime: '5min', limit: 1 },
      });
      
      const data = response.data;
      
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg} (code: ${data.retCode})`);
      }
      
      const item = data?.result?.list?.[0];
      if (!item) return null;
      
      this.recordSuccess();
      
      return {
        t: toNum(item.timestamp) || Date.now(),
        openInterest: toNum(item.openInterest),
        openInterestUsd: undefined, // Bybit doesn't provide USD value directly
      };
    } catch (err: any) {
      this.recordError(err);
      return null;
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // FUNDING RATE
  // ─────────────────────────────────────────────────────────────
  
  async getFunding(symbol: string): Promise<FundingSnapshot | null> {
    try {
      const client = await getClient();
      
      // Get ticker for funding info
      const response = await client.get('/v5/market/tickers', {
        params: { category: this.category, symbol },
      });
      
      const data = response.data;
      
      if (data.retCode !== 0) {
        throw new Error(`Bybit API error: ${data.retMsg} (code: ${data.retCode})`);
      }
      
      const item = data?.result?.list?.[0];
      if (!item) return null;
      
      this.recordSuccess();
      
      return {
        t: Date.now(),
        fundingRate: toNum(item.fundingRate),
        nextFundingTime: toNum(item.nextFundingTime),
      };
    } catch (err: any) {
      this.recordError(err);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const bybitUsdtPerpProvider = new BybitUsdtPerpProvider();

console.log('[Z1] Bybit USDT Perp Provider loaded');
