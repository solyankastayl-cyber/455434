/**
 * X2 — Binance USDT-M Futures Provider
 * =====================================
 * 
 * Real data from Binance Futures (USDT-M perpetuals).
 * Uses centralized HTTP client with proxy support.
 * 
 * Endpoints:
 * - /fapi/v1/exchangeInfo - symbols
 * - /fapi/v1/klines - candles
 * - /fapi/v1/depth - order book
 * - /fapi/v1/trades - recent trades
 * - /fapi/v1/openInterest - OI
 * - /fapi/v1/premiumIndex - funding
 */

import {
  IExchangeProvider,
  ProviderId,
  ProviderHealth,
  MarketSymbol,
  Candle,
  OrderBook,
  Trade,
  OISnapshot,
  FundingSnapshot,
} from './exchangeProvider.types.js';

import { registerSuccess, registerError, createInitialHealth } from './provider.health.js';
import { updateProviderHealth } from './provider.registry.js';
import { createBinanceClient } from '../../network/httpClient.factory.js';
import { AxiosInstance } from 'axios';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const BASE_URL = 'https://fapi.binance.com';

// ═══════════════════════════════════════════════════════════════
// HTTP CLIENT (lazy initialization)
// ═══════════════════════════════════════════════════════════════

let httpClient: AxiosInstance | null = null;

async function getClient(): Promise<AxiosInstance> {
  if (!httpClient) {
    httpClient = await createBinanceClient();
  }
  return httpClient;
}

// Reset client (for proxy config changes)
export function resetBinanceClient(): void {
  httpClient = null;
  console.log('[BinanceUSDM] HTTP client reset');
}

// ═══════════════════════════════════════════════════════════════
// BINANCE PROVIDER
// ═══════════════════════════════════════════════════════════════

export class BinanceUSDMProvider implements IExchangeProvider {
  readonly id: ProviderId = 'BINANCE_USDM';
  private healthState: ProviderHealth = createInitialHealth('BINANCE_USDM');
  
  async health(): Promise<ProviderHealth> {
    try {
      const client = await getClient();
      const response = await client.get('/fapi/v1/ticker/price', {
        params: { symbol: 'BTCUSDT' },
        timeout: 5000,
      });
      
      if (response.status === 200) {
        this.healthState = registerSuccess(this.healthState);
      } else {
        this.healthState = registerError(this.healthState, `HTTP ${response.status}`);
      }
    } catch (error: any) {
      const msg = error.response?.status 
        ? `HTTP ${error.response.status}` 
        : error.message || String(error);
      this.healthState = registerError(this.healthState, msg);
    }
    
    return this.healthState;
  }
  
  async getSymbols(): Promise<MarketSymbol[]> {
    const client = await getClient();
    
    try {
      const response = await client.get('/fapi/v1/exchangeInfo');
      const data = response.data;
      
      this.healthState = registerSuccess(this.healthState);
      updateProviderHealth(this.id, this.healthState);
      
      return data.symbols
        .filter((s: any) => s.contractType === 'PERPETUAL' && s.status === 'TRADING')
        .map((s: any) => {
          const lotSize = s.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
          const priceFilter = s.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
          
          return {
            symbol: s.symbol,
            base: s.baseAsset,
            quote: s.quoteAsset,
            status: s.status === 'TRADING' ? 'TRADING' : 'HALT',
            minQty: lotSize ? Number(lotSize.minQty) : undefined,
            tickSize: priceFilter ? Number(priceFilter.tickSize) : undefined,
            contractType: s.contractType,
          } as MarketSymbol;
        });
    } catch (error: any) {
      const msg = error.response?.status 
        ? `HTTP ${error.response.status}` 
        : error.message || String(error);
      this.healthState = registerError(this.healthState, msg);
      updateProviderHealth(this.id, this.healthState);
      throw error;
    }
  }
  
  async getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const client = await getClient();
    
    try {
      const response = await client.get('/fapi/v1/klines', {
        params: { symbol, interval, limit },
      });
      
      this.healthState = registerSuccess(this.healthState);
      updateProviderHealth(this.id, this.healthState);
      
      return response.data.map((k: any) => ({
        t: k[0],
        o: +k[1],
        h: +k[2],
        l: +k[3],
        c: +k[4],
        v: +k[5],
      }));
    } catch (error: any) {
      const msg = error.response?.status 
        ? `HTTP ${error.response.status}` 
        : error.message || String(error);
      this.healthState = registerError(this.healthState, msg);
      updateProviderHealth(this.id, this.healthState);
      throw error;
    }
  }
  
  async getOrderBook(symbol: string, depth: number): Promise<OrderBook> {
    const client = await getClient();
    
    try {
      const response = await client.get('/fapi/v1/depth', {
        params: { symbol, limit: Math.min(depth, 1000) },
      });
      
      this.healthState = registerSuccess(this.healthState);
      updateProviderHealth(this.id, this.healthState);
      
      const data = response.data;
      const bids: [number, number][] = data.bids.map((b: any) => [+b[0], +b[1]]);
      const asks: [number, number][] = data.asks.map((a: any) => [+a[0], +a[1]]);
      
      const bestBid = bids[0]?.[0] || 0;
      const bestAsk = asks[0]?.[0] || 0;
      const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0;
      
      return {
        t: Date.now(),
        bids,
        asks,
        mid,
      };
    } catch (error: any) {
      const msg = error.response?.status 
        ? `HTTP ${error.response.status}` 
        : error.message || String(error);
      this.healthState = registerError(this.healthState, msg);
      updateProviderHealth(this.id, this.healthState);
      throw error;
    }
  }
  
  async getTrades(symbol: string, limit: number): Promise<Trade[]> {
    const client = await getClient();
    
    try {
      const response = await client.get('/fapi/v1/trades', {
        params: { symbol, limit: Math.min(limit, 1000) },
      });
      
      this.healthState = registerSuccess(this.healthState);
      updateProviderHealth(this.id, this.healthState);
      
      return response.data.map((t: any) => ({
        t: t.time,
        price: +t.price,
        qty: +t.qty,
        side: t.isBuyerMaker ? 'SELL' : 'BUY',
        isBuyerMaker: t.isBuyerMaker,
      }));
    } catch (error: any) {
      const msg = error.response?.status 
        ? `HTTP ${error.response.status}` 
        : error.message || String(error);
      this.healthState = registerError(this.healthState, msg);
      updateProviderHealth(this.id, this.healthState);
      throw error;
    }
  }
  
  async getOpenInterest(symbol: string): Promise<OISnapshot | null> {
    const client = await getClient();
    
    try {
      const response = await client.get('/fapi/v1/openInterest', {
        params: { symbol },
      });
      
      this.healthState = registerSuccess(this.healthState);
      updateProviderHealth(this.id, this.healthState);
      
      return {
        t: Date.now(),
        openInterest: +response.data.openInterest,
      };
    } catch (error: any) {
      const msg = error.response?.status 
        ? `HTTP ${error.response.status}` 
        : error.message || String(error);
      this.healthState = registerError(this.healthState, msg);
      updateProviderHealth(this.id, this.healthState);
      return null;
    }
  }
  
  async getFunding(symbol: string): Promise<FundingSnapshot | null> {
    const client = await getClient();
    
    try {
      const response = await client.get('/fapi/v1/premiumIndex', {
        params: { symbol },
      });
      
      this.healthState = registerSuccess(this.healthState);
      updateProviderHealth(this.id, this.healthState);
      
      return {
        t: Date.now(),
        fundingRate: +response.data.lastFundingRate,
        nextFundingTime: response.data.nextFundingTime,
      };
    } catch (error: any) {
      const msg = error.response?.status 
        ? `HTTP ${error.response.status}` 
        : error.message || String(error);
      this.healthState = registerError(this.healthState, msg);
      updateProviderHealth(this.id, this.healthState);
      return null;
    }
  }
}

// Export singleton
export const binanceUSDMProvider = new BinanceUSDMProvider();

console.log('[X2] Binance USDM Provider loaded');
