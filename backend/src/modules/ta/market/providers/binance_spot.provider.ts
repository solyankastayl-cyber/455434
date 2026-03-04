/**
 * Phase J: Binance Spot Market Provider
 * 
 * Production-ready provider for fetching candle data from Binance
 */

import axios from 'axios';
import { MarketCandle, FetchCandlesParams, MarketProviderConfig, DEFAULT_MARKET_CONFIG } from '../market_types.js';
import { Candle as OutcomeCandle } from '../../outcomes_v2/market_provider.js';

// Rate limiter state
let lastRequestTime = 0;

/**
 * Map internal timeframe notation to Binance interval
 */
function mapInterval(tf: string): string {
  const map: Record<string, string> = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1H': '1h',
    '1h': '1h',
    '2h': '2h',
    '4H': '4h',
    '4h': '4h',
    '6h': '6h',
    '8h': '8h',
    '12h': '12h',
    '1D': '1d',
    '1d': '1d',
    '3d': '3d',
    '1W': '1w',
    '1w': '1w',
    '1M': '1M',
  };
  return map[tf] || '1d';
}

/**
 * Binance Spot Market Provider
 */
export class BinanceSpotProvider {
  private config: MarketProviderConfig;
  
  constructor(config: Partial<MarketProviderConfig> = {}) {
    this.config = { ...DEFAULT_MARKET_CONFIG, ...config };
  }
  
  /**
   * Rate limit enforcement
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    const waitMs = this.config.rateLimitMs || 100;
    
    if (elapsed < waitMs) {
      await new Promise(resolve => setTimeout(resolve, waitMs - elapsed));
    }
    
    lastRequestTime = Date.now();
  }
  
  /**
   * Fetch candles from Binance Spot API
   */
  async fetchCandles(params: FetchCandlesParams): Promise<MarketCandle[]> {
    await this.waitForRateLimit();
    
    const url = `${this.config.baseUrl}/api/v3/klines`;
    const interval = mapInterval(params.interval);
    
    try {
      const response = await axios.get(url, {
        params: {
          symbol: params.symbol.toUpperCase(),
          interval,
          startTime: params.startTime,
          endTime: params.endTime,
          limit: Math.min(params.limit || 500, 1000),
        },
        timeout: this.config.timeout,
      });
      
      return response.data.map((k: any[]) => ({
        ts: k[0],
        o: parseFloat(k[1]),
        h: parseFloat(k[2]),
        l: parseFloat(k[3]),
        c: parseFloat(k[4]),
        v: parseFloat(k[5]),
      }));
    } catch (error: any) {
      console.error(`[BinanceSpotProvider] Error fetching ${params.symbol}:`, error.message);
      return [];
    }
  }
  
  /**
   * Get candles for outcome evaluation (implements MarketProvider interface)
   */
  async getCandles(params: {
    asset: string;
    timeframe: string;
    fromTs: number;
    limit: number;
  }): Promise<OutcomeCandle[]> {
    // Map asset to Binance symbol if needed
    let symbol = params.asset.toUpperCase();
    if (!symbol.includes('USDT') && !symbol.includes('BTC') && !symbol.includes('ETH')) {
      // Default to USDT pair for crypto
      symbol = symbol + 'USDT';
    }
    
    const candles = await this.fetchCandles({
      symbol,
      interval: params.timeframe,
      startTime: params.fromTs,
      limit: params.limit,
    });
    
    // Convert to outcome candle format
    return candles.map(c => ({
      ts: c.ts,
      o: c.o,
      h: c.h,
      l: c.l,
      c: c.c,
      v: c.v,
    }));
  }
  
  /**
   * Get latest price for a symbol
   */
  async getLatestPrice(symbol: string): Promise<number | null> {
    await this.waitForRateLimit();
    
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/v3/ticker/price`, {
        params: { symbol: symbol.toUpperCase() },
        timeout: this.config.timeout,
      });
      
      return parseFloat(response.data.price);
    } catch (error: any) {
      console.error(`[BinanceSpotProvider] Error fetching price for ${symbol}:`, error.message);
      return null;
    }
  }
  
  /**
   * Check if a symbol is valid on Binance
   */
  async isValidSymbol(symbol: string): Promise<boolean> {
    const price = await this.getLatestPrice(symbol);
    return price !== null;
  }
}

// Singleton instance
export const binanceSpotProvider = new BinanceSpotProvider();
