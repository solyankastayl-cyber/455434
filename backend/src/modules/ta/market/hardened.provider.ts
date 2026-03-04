/**
 * Phase S2: Hardened Market Data Provider
 * Wraps base provider with Cache + RateLimit + CircuitBreaker
 */

import { getConfig } from '../infra/config.js';
import { LRUCache, getCandleCache, candleCacheKey } from '../infra/cache.js';
import { RateLimiter, getRateLimiter } from '../infra/ratelimit.js';
import { CircuitBreaker, getCircuitBreaker, CircuitOpenError } from '../infra/breaker.js';
import { getMetrics } from '../infra/metrics.js';
import { logger } from '../infra/logger.js';
import { getCandlesWithFallback, checkSufficientData, createInsufficientDataResult, DataStatus } from '../infra/degradation.js';
import { Candle, MarketDataProvider, MockMarketDataProvider, BinanceMarketDataProvider } from '../data/market.provider.js';

export interface HardenedCandles {
  candles: Candle[];
  dataStatus: DataStatus;
}

/**
 * Hardened Market Data Provider
 * Wraps any base provider with production hardening:
 * - LRU Cache with TTL
 * - Token bucket rate limiting
 * - Circuit breaker pattern
 * - Graceful degradation (stale cache fallback)
 */
export class HardenedMarketDataProvider implements MarketDataProvider {
  private baseProvider: MarketDataProvider;
  private cache: LRUCache<Candle[]>;
  private rateLimiter: RateLimiter;
  private breaker: CircuitBreaker;
  private metrics = getMetrics();

  constructor(baseProvider?: MarketDataProvider) {
    const config = getConfig();
    
    // Select base provider
    if (baseProvider) {
      this.baseProvider = baseProvider;
    } else if (config.provider === 'BINANCE') {
      this.baseProvider = new BinanceMarketDataProvider();
    } else {
      this.baseProvider = new MockMarketDataProvider();
    }

    // Initialize hardening components
    this.cache = getCandleCache();
    this.rateLimiter = getRateLimiter();
    this.breaker = getCircuitBreaker('provider');

    logger.info({ 
      phase: 'init', 
      provider: this.baseProvider.getName(),
      cacheMaxKeys: config.cacheMaxKeys,
      rateLimitRps: config.rateLimitRps,
      breakerThreshold: config.breakerFailThreshold
    }, 'HardenedMarketDataProvider initialized');
  }

  getName(): string {
    return `Hardened(${this.baseProvider.getName()})`;
  }

  /**
   * Get candles with full hardening stack
   */
  async getCandles(symbol: string, timeframe: string, limit: number = 200): Promise<Candle[]> {
    const result = await this.getCandlesWithStatus(symbol, timeframe, limit);
    return result.candles;
  }

  /**
   * Get candles with data status (for API response)
   */
  async getCandlesWithStatus(
    symbol: string, 
    timeframe: string, 
    limit: number = 200
  ): Promise<HardenedCandles> {
    const config = getConfig();
    const cacheKey = candleCacheKey(symbol, timeframe, 0, limit);
    
    // 1. Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug({ phase: 'cache_hit', symbol, timeframe }, 'Cache hit');
      
      return {
        candles: cached,
        dataStatus: {
          source: 'LIVE',
          isStale: false,
          stalenessSec: 0,
          candleCount: cached.length,
          sufficient: checkSufficientData(cached.length).sufficient,
          requiredCandles: config.minCandlesRequired,
        }
      };
    }

    // 2. Use degradation wrapper for fallback support
    return getCandlesWithFallback(symbol, timeframe, async () => {
      // 2a. Check rate limit
      const allowed = await this.rateLimiter.acquire('provider');
      if (!allowed) {
        this.metrics.recordError();
        logger.warn({ phase: 'rate_limit', symbol, timeframe }, 'Rate limit exceeded');
        throw new Error('RATE_LIMIT_EXCEEDED');
      }

      // 2b. Execute through circuit breaker
      const candles = await this.breaker.execute(async () => {
        const start = Date.now();
        
        try {
          const data = await this.baseProvider.getCandles(symbol, timeframe, limit);
          
          const duration = Date.now() - start;
          this.metrics.recordLatency('fetch_data', duration);
          
          logger.debug({ 
            phase: 'fetch_data', 
            symbol, 
            timeframe, 
            count: data.length,
            ms: duration 
          }, 'Fetched candles');
          
          return data;
        } catch (error) {
          this.metrics.recordError();
          throw error;
        }
      });

      // 2c. Cache the result
      const ttlMs = this.getTtlMs(timeframe);
      this.cache.set(cacheKey, candles, ttlMs);
      
      return candles;
    });
  }

  /**
   * Get TTL based on timeframe
   */
  private getTtlMs(timeframe: string): number {
    const config = getConfig();
    
    // Daily and higher timeframes get longer TTL
    if (['1D', '1d', '1W', '1w'].includes(timeframe)) {
      return config.cacheTtlSecDaily * 1000;
    }
    
    return config.cacheTtlSec * 1000;
  }

  /**
   * Get provider status
   */
  getStatus(): {
    provider: string;
    breaker: ReturnType<CircuitBreaker['getStats']>;
    cache: ReturnType<LRUCache<any>['getStats']>;
    rateLimit: ReturnType<RateLimiter['getStats']>;
  } {
    return {
      provider: this.baseProvider.getName(),
      breaker: this.breaker.getStats(),
      cache: this.cache.getStats(),
      rateLimit: this.rateLimiter.getStats(),
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info({ phase: 'cache_clear' }, 'Cache cleared');
  }

  /**
   * Prune expired cache entries
   */
  pruneCache(): number {
    return this.cache.prune();
  }
}

// Singleton instance
let hardenedProvider: HardenedMarketDataProvider | null = null;

export function getHardenedProvider(): HardenedMarketDataProvider {
  if (!hardenedProvider) {
    hardenedProvider = new HardenedMarketDataProvider();
  }
  return hardenedProvider;
}

/**
 * Reset provider (for testing)
 */
export function resetHardenedProvider(): void {
  hardenedProvider = null;
}
