/**
 * Phase V: Enhanced Binance Spot Provider
 * 
 * Real market data with Phase S hardening:
 * - Rate limiting
 * - Circuit breaker
 * - Caching
 * - Error handling
 */

import { Candle, MarketDataProvider } from '../data/market.provider.js';
import { getCircuitBreaker } from '../infra/breaker.js';
import { getRateLimiter } from '../infra/ratelimit.js';
import { getCandleCache, candleCacheKey } from '../infra/cache.js';
import { getConfig } from '../infra/config.js';
import { logger } from '../infra/logger.js';
import { getMetrics } from '../infra/metrics.js';

const BINANCE_BASE_URL = 'https://api.binance.com/api/v3';

const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1D': '1d',
  '1w': '1w',
  '1W': '1w',
};

export interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  trades: number;
  takerBuyBaseVolume: string;
  takerBuyQuoteVolume: string;
}

export class BinanceSpotProviderV2 implements MarketDataProvider {
  private breaker = getCircuitBreaker('binance');
  private rateLimiter = getRateLimiter();
  private cache = getCandleCache();
  private metrics = getMetrics();

  getName(): string {
    return 'BinanceSpotV2';
  }

  async getCandles(symbol: string, timeframe: string, limit: number = 200): Promise<Candle[]> {
    const config = getConfig();
    const interval = TIMEFRAME_MAP[timeframe] || '1h';
    const cacheKey = candleCacheKey(symbol, timeframe, 0, limit);

    // 1. Check cache
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug({ phase: 'cache_hit', symbol, timeframe }, 'Binance cache hit');
      return cached;
    }

    // 2. Rate limit check
    const allowed = await this.rateLimiter.acquire('binance');
    if (!allowed) {
      this.metrics.recordError();
      throw new Error('RATE_LIMIT_EXCEEDED');
    }

    // 3. Execute through circuit breaker
    const candles = await this.breaker.execute(async () => {
      const start = Date.now();
      
      try {
        const response = await fetch(
          `${BINANCE_BASE_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
        );
        
        if (!response.ok) {
          throw new Error(`Binance API error: ${response.status}`);
        }
        
        const data = await response.json() as any[];
        
        const result: Candle[] = data.map((k: any) => ({
          ts: k[0],
          date: new Date(k[0]).toISOString().split('T')[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
        
        const duration = Date.now() - start;
        this.metrics.recordLatency('binance_fetch', duration);
        
        logger.info({ 
          phase: 'binance_fetch', 
          symbol, 
          timeframe, 
          count: result.length,
          ms: duration 
        }, 'Fetched candles from Binance');
        
        return result;
      } catch (error) {
        this.metrics.recordError();
        throw error;
      }
    });

    // 4. Cache result
    const ttlMs = this.getTtlMs(timeframe);
    this.cache.set(cacheKey, candles, ttlMs);
    
    return candles;
  }

  async getPrice(symbol: string): Promise<number> {
    const allowed = await this.rateLimiter.acquire('binance');
    if (!allowed) {
      throw new Error('RATE_LIMIT_EXCEEDED');
    }

    return this.breaker.execute(async () => {
      const response = await fetch(
        `${BINANCE_BASE_URL}/ticker/price?symbol=${symbol}`
      );
      
      if (!response.ok) {
        throw new Error(`Binance API error: ${response.status}`);
      }
      
      const data = await response.json() as { symbol: string; price: string };
      return parseFloat(data.price);
    });
  }

  /**
   * Get historical candles for specific time range
   */
  async getHistoricalCandles(
    symbol: string,
    timeframe: string,
    startTime: number,
    endTime: number,
    limit: number = 1000
  ): Promise<Candle[]> {
    const interval = TIMEFRAME_MAP[timeframe] || '1h';
    
    const allowed = await this.rateLimiter.acquire('binance');
    if (!allowed) {
      throw new Error('RATE_LIMIT_EXCEEDED');
    }

    return this.breaker.execute(async () => {
      const response = await fetch(
        `${BINANCE_BASE_URL}/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`
      );
      
      if (!response.ok) {
        throw new Error(`Binance API error: ${response.status}`);
      }
      
      const data = await response.json() as any[];
      
      return data.map((k: any) => ({
        ts: k[0],
        date: new Date(k[0]).toISOString().split('T')[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    });
  }

  private getTtlMs(timeframe: string): number {
    const config = getConfig();
    
    if (['1d', '1D', '1w', '1W'].includes(timeframe)) {
      return config.cacheTtlSecDaily * 1000;
    }
    
    return config.cacheTtlSec * 1000;
  }

  getStatus() {
    return {
      provider: this.getName(),
      breaker: this.breaker.getStats(),
      cache: this.cache.getStats(),
      rateLimit: this.rateLimiter.getStats(),
    };
  }
}

// Singleton instance
let binanceProviderV2: BinanceSpotProviderV2 | null = null;

export function getBinanceProviderV2(): BinanceSpotProviderV2 {
  if (!binanceProviderV2) {
    binanceProviderV2 = new BinanceSpotProviderV2();
  }
  return binanceProviderV2;
}
