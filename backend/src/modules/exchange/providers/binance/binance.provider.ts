/**
 * S10.1 — Binance Provider
 * 
 * PRINCIPLES:
 * - Provider = dumb data fetcher
 * - No computations, no logic
 * - Only fetch + normalize
 * - Rate limit aware
 */

import axios, { AxiosInstance } from 'axios';
import {
  ExchangeMarketSnapshot,
  OrderBookSnapshot,
  TradeFlowSnapshot,
  OpenInterestSnapshot,
  LiquidationEvent,
  OrderBookLevel,
} from '../../models/exchange.types.js';
import { providerStatusCache } from '../../models/exchange.model.js';

const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';

export class BinanceProvider {
  private client: AxiosInstance;
  private errorCount = 0;
  private lastUpdate = new Date();
  private rateLimitUsed = 0;

  constructor() {
    this.client = axios.create({
      baseURL: BINANCE_FUTURES_BASE,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Track rate limits from response headers
    this.client.interceptors.response.use(
      (response) => {
        this.lastUpdate = new Date();
        this.errorCount = 0;
        
        // Binance returns rate limit info in headers
        const usedWeight = response.headers['x-mbx-used-weight-1m'];
        if (usedWeight) {
          this.rateLimitUsed = (parseInt(usedWeight) / 1200) * 100; // 1200 is default limit
        }
        
        this.updateStatus('OK');
        return response;
      },
      (error) => {
        this.errorCount++;
        this.updateStatus(this.errorCount > 3 ? 'DOWN' : 'DEGRADED');
        throw error;
      }
    );
  }

  private updateStatus(status: 'OK' | 'DEGRADED' | 'DOWN') {
    providerStatusCache.set('binance', {
      provider: 'binance',
      status,
      lastUpdate: this.lastUpdate,
      errorCount: this.errorCount,
      rateLimitUsed: this.rateLimitUsed,
      latencyMs: 0,
    });
  }

  /**
   * Get all futures markets
   */
  async getMarkets(): Promise<ExchangeMarketSnapshot[]> {
    const start = Date.now();
    try {
      const [ticker24h, prices] = await Promise.all([
        this.client.get('/fapi/v1/ticker/24hr'),
        this.client.get('/fapi/v1/ticker/price'),
      ]);

      const priceMap = new Map(
        prices.data.map((p: any) => [p.symbol, parseFloat(p.price)])
      );

      const markets: ExchangeMarketSnapshot[] = ticker24h.data
        .filter((t: any) => t.symbol.endsWith('USDT'))
        .map((t: any) => ({
          symbol: t.symbol,
          price: priceMap.get(t.symbol) || parseFloat(t.lastPrice),
          change24h: parseFloat(t.priceChangePercent),
          volume24h: parseFloat(t.quoteVolume),
          volatility: Math.min((parseFloat(t.highPrice) - parseFloat(t.lowPrice)) / parseFloat(t.lastPrice), 1),
          high24h: parseFloat(t.highPrice),
          low24h: parseFloat(t.lowPrice),
          trades24h: parseInt(t.count),
          timestamp: new Date(),
          latencyMs: Date.now() - start,
        }));

      return markets;
    } catch (error) {
      console.error('[BinanceProvider] getMarkets error:', error);
      return [];
    }
  }

  /**
   * Get order book for symbol
   */
  async getOrderBook(symbol: string, limit = 20): Promise<OrderBookSnapshot | null> {
    const start = Date.now();
    try {
      const response = await this.client.get('/fapi/v1/depth', {
        params: { symbol, limit },
      });

      const { bids, asks } = response.data;

      const bidLevels: OrderBookLevel[] = bids.map((b: string[]) => ({
        price: parseFloat(b[0]),
        quantity: parseFloat(b[1]),
      }));

      const askLevels: OrderBookLevel[] = asks.map((a: string[]) => ({
        price: parseFloat(a[0]),
        quantity: parseFloat(a[1]),
      }));

      return {
        symbol,
        bids: bidLevels,
        asks: askLevels,
        spread: askLevels[0].price - bidLevels[0].price,
        spreadPercent: ((askLevels[0].price - bidLevels[0].price) / bidLevels[0].price) * 100,
        bidDepth: bidLevels.reduce((sum, b) => sum + b.quantity * b.price, 0),
        askDepth: askLevels.reduce((sum, a) => sum + a.quantity * a.price, 0),
        timestamp: new Date(),
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      console.error('[BinanceProvider] getOrderBook error:', error);
      return null;
    }
  }

  /**
   * Get recent trades for symbol
   */
  async getTrades(symbol: string, limit = 500): Promise<TradeFlowSnapshot | null> {
    const start = Date.now();
    try {
      const response = await this.client.get('/fapi/v1/trades', {
        params: { symbol, limit },
      });

      const trades = response.data;
      let buyVolume = 0;
      let sellVolume = 0;
      let totalValue = 0;

      for (const t of trades) {
        const value = parseFloat(t.price) * parseFloat(t.qty);
        totalValue += value;
        const volume = parseFloat(t.qty);
        
        if (t.isBuyerMaker) {
          sellVolume += volume; // Buyer is maker = seller aggressor
        } else {
          buyVolume += volume;
        }
      }

      return {
        symbol,
        buyVolume,
        sellVolume,
        totalVolume: buyVolume + sellVolume,
        buyRatio: buyVolume / (buyVolume + sellVolume),
        avgTradeSize: (buyVolume + sellVolume) / trades.length,
        tradesCount: trades.length,
        totalValue,
        timestamp: new Date(),
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      console.error('[BinanceProvider] getTrades error:', error);
      return null;
    }
  }

  /**
   * Get open interest for symbol
   */
  async getOpenInterest(symbol: string): Promise<OpenInterestSnapshot | null> {
    const start = Date.now();
    try {
      const [oiResponse, fundingResponse] = await Promise.all([
        this.client.get('/fapi/v1/openInterest', { params: { symbol } }),
        this.client.get('/fapi/v1/premiumIndex', { params: { symbol } }),
      ]);

      return {
        symbol,
        openInterest: parseFloat(oiResponse.data.openInterest),
        openInterestUsd: parseFloat(oiResponse.data.openInterest) * parseFloat(fundingResponse.data.markPrice),
        fundingRate: parseFloat(fundingResponse.data.lastFundingRate),
        markPrice: parseFloat(fundingResponse.data.markPrice),
        indexPrice: parseFloat(fundingResponse.data.indexPrice),
        timestamp: new Date(),
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      console.error('[BinanceProvider] getOpenInterest error:', error);
      return null;
    }
  }

  /**
   * Get liquidations
   */
  async getLiquidations(symbol?: string, limit = 100): Promise<LiquidationEvent[]> {
    const start = Date.now();
    try {
      const params: any = { limit };
      if (symbol) params.symbol = symbol;

      const response = await this.client.get('/fapi/v1/allForceOrders', { params });

      return response.data.map((l: any) => ({
        symbol: l.symbol,
        side: l.side,
        price: parseFloat(l.price),
        quantity: parseFloat(l.origQty),
        value: parseFloat(l.price) * parseFloat(l.origQty),
        timestamp: new Date(l.time),
        latencyMs: Date.now() - start,
      }));
    } catch (error) {
      console.error('[BinanceProvider] getLiquidations error:', error);
      return [];
    }
  }

  /**
   * Get funding rates for all symbols
   */
  async getFundingRates(): Promise<Map<string, number>> {
    try {
      const response = await this.client.get('/fapi/v1/premiumIndex');
      const rates = new Map<string, number>();

      for (const item of response.data) {
        if (item.symbol.endsWith('USDT')) {
          rates.set(item.symbol, parseFloat(item.lastFundingRate));
        }
      }

      return rates;
    } catch (error) {
      console.error('[BinanceProvider] getFundingRates error:', error);
      return new Map();
    }
  }
}

// Export singleton
export const binanceProvider = new BinanceProvider();
console.log('[S10.1] Binance Provider loaded');
