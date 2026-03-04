/**
 * PHASE 1.3 — Rate Limiter
 * =========================
 * Safe rate limiting for REST API calls
 */

import Bottleneck from 'bottleneck';

export type RateLimitConfig = {
  minTime: number;      // ms between requests
  maxConcurrent: number;
  reservoir?: number;   // max requests per interval
  reservoirRefreshInterval?: number;
};

// Provider-specific safe limits
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  BYBIT: {
    minTime: 200,        // 5 req/sec
    maxConcurrent: 3,
  },
  BINANCE: {
    minTime: 250,        // 4 req/sec
    maxConcurrent: 2,
  },
  COINBASE: {
    minTime: 300,        // 3.3 req/sec
    maxConcurrent: 1,
  },
  DEFAULT: {
    minTime: 300,
    maxConcurrent: 1,
  },
};

const limiters = new Map<string, Bottleneck>();

export function getRateLimiter(provider: string): Bottleneck {
  if (!limiters.has(provider)) {
    const config = RATE_LIMITS[provider] || RATE_LIMITS.DEFAULT;
    
    const limiter = new Bottleneck({
      minTime: config.minTime,
      maxConcurrent: config.maxConcurrent,
      reservoir: config.reservoir,
      reservoirRefreshInterval: config.reservoirRefreshInterval,
    });
    
    // Log rate limit events
    limiter.on('depleted', () => {
      console.log(`[RateLimiter] ${provider} reservoir depleted, waiting...`);
    });
    
    limiters.set(provider, limiter);
  }
  
  return limiters.get(provider)!;
}

export function schedule<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const limiter = getRateLimiter(provider);
  return limiter.schedule(fn);
}

console.log('[Phase 1.3] Rate Limiter loaded');
