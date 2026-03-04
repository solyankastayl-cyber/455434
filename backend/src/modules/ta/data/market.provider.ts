/**
 * Market Data Provider - Abstraction for OHLCV data
 * 
 * Implements interface for modular TA Engine:
 * - Mock data for development/testing
 * - Binance API for production
 * 
 * TA Engine depends only on this interface, making it portable.
 */

import { getMongoDb } from '../../../db/mongoose.js';
import axios from 'axios';

export interface Candle {
  ts: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataProvider {
  getCandles(symbol: string, timeframe: string, limit?: number): Promise<Candle[]>;
  getName(): string;
}

/**
 * MongoDB Provider - reads from existing collections
 */
export class MongoMarketDataProvider implements MarketDataProvider {
  getName(): string {
    return 'MongoDB';
  }

  async getCandles(symbol: string, timeframe: string, limit: number = 200): Promise<Candle[]> {
    const db = getMongoDb();
    
    let collection = 'candles';
    if (symbol.toUpperCase() === 'SPX') {
      collection = 'spx_candles';
    } else if (symbol.toUpperCase() === 'DXY') {
      collection = 'dxy_candles';
    } else if (symbol.toUpperCase().includes('BTC')) {
      collection = 'btc_candles';
    }

    const candles = await db.collection(collection)
      .find({ timeframe: timeframe })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();

    return candles.reverse().map((c: any) => ({
      ts: c.ts || new Date(c.date).getTime(),
      date: c.date || new Date(c.ts).toISOString().split('T')[0],
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0
    }));
  }
}

/**
 * Binance Provider - fetches from Binance API
 */
export class BinanceMarketDataProvider implements MarketDataProvider {
  private baseUrl = 'https://api.binance.com';
  
  getName(): string {
    return 'Binance';
  }

  async getCandles(symbol: string, timeframe: string, limit: number = 200): Promise<Candle[]> {
    const interval = this.mapTimeframe(timeframe);
    
    try {
      const response = await axios.get(`${this.baseUrl}/api/v3/klines`, {
        params: {
          symbol: symbol.toUpperCase(),
          interval,
          limit
        },
        timeout: 10000
      });

      return response.data.map((k: any[]) => ({
        ts: k[0],
        date: new Date(k[0]).toISOString().split('T')[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    } catch (error) {
      console.error('[Binance] Failed to fetch candles:', error);
      return [];
    }
  }

  private mapTimeframe(tf: string): string {
    const map: Record<string, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1H': '1h',
      '1h': '1h',
      '4H': '4h',
      '4h': '4h',
      '1D': '1d',
      '1d': '1d',
      '1W': '1w',
      '1w': '1w'
    };
    return map[tf] || '1d';
  }
}

/**
 * Mock Provider - generates realistic test data
 */
import { getRNG } from '../infra/rng.js';

export class MockMarketDataProvider implements MarketDataProvider {
  getName(): string {
    return 'Mock';
  }

  async getCandles(symbol: string, timeframe: string, limit: number = 200): Promise<Candle[]> {
    const candles: Candle[] = [];
    const now = Date.now();
    const tfMs = this.getTimeframeMs(timeframe);
    
    // Phase S3: Use seeded RNG for deterministic mock data
    const rng = getRNG();
    
    // Base prices for different assets
    let basePrice = 50000; // BTC default
    if (symbol.toUpperCase() === 'SPX') basePrice = 5800;
    else if (symbol.toUpperCase() === 'DXY') basePrice = 104;
    else if (symbol.toUpperCase().includes('ETH')) basePrice = 3500;
    
    let price = basePrice;
    const volatility = basePrice * 0.02; // 2% volatility

    for (let i = limit - 1; i >= 0; i--) {
      const ts = now - (i * tfMs);
      
      // Random walk with mean reversion (using seeded RNG)
      const change = (rng.next() - 0.5) * volatility;
      const meanReversion = (basePrice - price) * 0.05;
      price = price + change + meanReversion;
      
      const open = price;
      const range = price * (0.005 + rng.next() * 0.015); // 0.5-2% range
      const high = open + range * rng.next();
      const low = open - range * rng.next();
      const close = low + (high - low) * rng.next();
      
      candles.push({
        ts,
        date: new Date(ts).toISOString().split('T')[0],
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(Math.max(open, high, close).toFixed(2)),
        low: parseFloat(Math.min(open, low, close).toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: Math.floor(rng.next() * 10000000)
      });
      
      price = close;
    }

    return candles;
  }

  private getTimeframeMs(tf: string): number {
    const map: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1H': 60 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4H': 4 * 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1W': 7 * 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000
    };
    return map[tf] || 24 * 60 * 60 * 1000;
  }
}

/**
 * Factory function to get appropriate provider
 */
export function getMarketDataProvider(type: 'mongo' | 'binance' | 'mock' = 'mock'): MarketDataProvider {
  switch (type) {
    case 'binance':
      return new BinanceMarketDataProvider();
    case 'mongo':
      return new MongoMarketDataProvider();
    case 'mock':
    default:
      return new MockMarketDataProvider();
  }
}

// Export singleton instance
export const marketDataProvider = new MockMarketDataProvider();
