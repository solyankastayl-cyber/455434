/**
 * Phase J: Mock Market Provider for testing
 */

import { MarketCandle, FetchCandlesParams } from '../market_types.js';
import { Candle as OutcomeCandle } from '../../outcomes_v2/market_provider.js';

/**
 * Mock provider that generates realistic-looking candle data
 */
export class MockMarketProvider {
  private basePrice: number = 50000;
  
  /**
   * Fetch mock candles
   */
  async fetchCandles(params: FetchCandlesParams): Promise<MarketCandle[]> {
    const limit = params.limit || 100;
    const now = Date.now();
    const intervalMs = this.getIntervalMs(params.interval);
    
    // Set base price based on symbol
    if (params.symbol.includes('BTC')) this.basePrice = 65000;
    else if (params.symbol.includes('ETH')) this.basePrice = 3500;
    else if (params.symbol === 'SPX') this.basePrice = 5800;
    else this.basePrice = 50000;
    
    const candles: MarketCandle[] = [];
    let price = this.basePrice;
    const startTs = params.startTime || (now - limit * intervalMs);
    
    for (let i = 0; i < limit; i++) {
      const ts = startTs + i * intervalMs;
      
      // Random walk with mean reversion
      const volatility = this.basePrice * 0.015;
      const change = (Math.random() - 0.5) * volatility;
      const meanReversion = (this.basePrice - price) * 0.03;
      price = price + change + meanReversion;
      
      const open = price;
      const range = price * (0.003 + Math.random() * 0.012);
      const high = open + range * Math.random();
      const low = open - range * Math.random();
      const close = low + (high - low) * Math.random();
      
      candles.push({
        ts,
        o: parseFloat(open.toFixed(2)),
        h: parseFloat(Math.max(open, high, close).toFixed(2)),
        l: parseFloat(Math.min(open, low, close).toFixed(2)),
        c: parseFloat(close.toFixed(2)),
        v: Math.floor(Math.random() * 10000000),
      });
      
      price = close;
    }
    
    return candles;
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
    const candles = await this.fetchCandles({
      symbol: params.asset,
      interval: params.timeframe,
      startTime: params.fromTs,
      limit: params.limit,
    });
    
    return candles.map(c => ({
      ts: c.ts,
      o: c.o,
      h: c.h,
      l: c.l,
      c: c.c,
      v: c.v,
    }));
  }
  
  private getIntervalMs(interval: string): number {
    const map: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '1H': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '4H': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
      '1W': 7 * 24 * 60 * 60 * 1000,
    };
    return map[interval] || 24 * 60 * 60 * 1000;
  }
}

// Singleton instance
export const mockMarketProvider = new MockMarketProvider();
