/**
 * PHASE 5.1 — Price Resolver Service
 * ====================================
 * Fetches historical prices for outcome calculation
 */

import { HistoricalPrice, PriceResolverConfig } from '../contracts/outcome.types.js';
import { createBybitClient } from '../../network/httpClient.factory.js';

// In-memory cache for prices
const priceCache = new Map<string, { price: number; timestamp: number }>();

const DEFAULT_CONFIG: PriceResolverConfig = {
  useCache: true,
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
  maxRetries: 3,
  fallbackToMock: true,
};

/**
 * Build cache key for price lookup
 */
function buildCacheKey(symbol: string, timestamp: number): string {
  // Round to nearest minute for cache efficiency
  const roundedTs = Math.floor(timestamp / 60000) * 60000;
  return `${symbol}:${roundedTs}`;
}

/**
 * Get price from cache
 */
function getFromCache(symbol: string, timestamp: number): number | null {
  const key = buildCacheKey(symbol, timestamp);
  const cached = priceCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < DEFAULT_CONFIG.cacheTtlMs) {
    return cached.price;
  }
  
  return null;
}

/**
 * Store price in cache
 */
function storeInCache(symbol: string, timestamp: number, price: number): void {
  const key = buildCacheKey(symbol, timestamp);
  priceCache.set(key, { price, timestamp: Date.now() });
  
  // Cleanup old entries (keep last 10000)
  if (priceCache.size > 10000) {
    const keys = Array.from(priceCache.keys());
    for (let i = 0; i < 1000; i++) {
      priceCache.delete(keys[i]);
    }
  }
}

/**
 * Fetch historical price from Bybit
 */
async function fetchFromBybit(
  symbol: string, 
  timestamp: number
): Promise<number | null> {
  try {
    const client = await createBybitClient();
    
    // Bybit kline endpoint - get 1-minute candle containing the timestamp
    const response = await client.get('/v5/market/kline', {
      params: {
        category: 'linear',
        symbol,
        interval: '1',
        start: timestamp,
        end: timestamp + 60000,
        limit: 1,
      },
    });
    
    if (response.data?.result?.list?.length > 0) {
      // Kline format: [timestamp, open, high, low, close, volume, turnover]
      const kline = response.data.result.list[0];
      const closePrice = parseFloat(kline[4]);
      return closePrice;
    }
    
    return null;
  } catch (error) {
    console.error(`[PriceResolver] Bybit fetch failed for ${symbol}:`, error);
    return null;
  }
}

/**
 * Generate mock price based on decision price and time delta
 * Used as fallback when real data is unavailable
 */
function generateMockPrice(
  symbol: string, 
  basePrice: number, 
  timeDeltaMs: number
): number {
  // Deterministic pseudo-random based on symbol and time
  const seed = symbol.charCodeAt(0) + timeDeltaMs;
  const random = Math.sin(seed) * 10000 - Math.floor(Math.sin(seed) * 10000);
  
  // Generate -5% to +5% change based on time horizon
  const maxChangePct = 0.05 * (timeDeltaMs / (24 * 60 * 60 * 1000));
  const changePct = (random - 0.5) * 2 * maxChangePct;
  
  return basePrice * (1 + changePct);
}

/**
 * Resolve historical price at a specific timestamp
 */
export async function resolvePrice(
  symbol: string,
  timestamp: number,
  basePrice?: number,
  config: Partial<PriceResolverConfig> = {}
): Promise<HistoricalPrice> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // Try cache first
  if (cfg.useCache) {
    const cached = getFromCache(symbol, timestamp);
    if (cached !== null) {
      return {
        symbol,
        timestamp,
        price: cached,
        source: 'CACHE',
      };
    }
  }
  
  // Try Bybit
  let retries = 0;
  while (retries < cfg.maxRetries) {
    const price = await fetchFromBybit(symbol, timestamp);
    if (price !== null) {
      storeInCache(symbol, timestamp, price);
      return {
        symbol,
        timestamp,
        price,
        source: 'BYBIT',
      };
    }
    retries++;
    await new Promise(r => setTimeout(r, 500 * retries));
  }
  
  // Fallback to mock if allowed and we have a base price
  if (cfg.fallbackToMock && basePrice) {
    const now = Date.now();
    const mockPrice = generateMockPrice(symbol, basePrice, timestamp - now);
    return {
      symbol,
      timestamp,
      price: mockPrice,
      source: 'MOCK',
    };
  }
  
  // Return null price with MOCK source to indicate failure
  return {
    symbol,
    timestamp,
    price: basePrice || 0,
    source: 'MOCK',
  };
}

/**
 * Batch resolve multiple prices
 */
export async function resolvePricesBatch(
  requests: Array<{ symbol: string; timestamp: number; basePrice?: number }>
): Promise<HistoricalPrice[]> {
  // Process in parallel with concurrency limit
  const BATCH_SIZE = 5;
  const results: HistoricalPrice[] = [];
  
  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(req => resolvePrice(req.symbol, req.timestamp, req.basePrice))
    );
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Get current price for a symbol
 */
export async function getCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const client = await createBybitClient();
    
    const response = await client.get('/v5/market/tickers', {
      params: {
        category: 'linear',
        symbol,
      },
    });
    
    if (response.data?.result?.list?.length > 0) {
      return parseFloat(response.data.result.list[0].lastPrice);
    }
    
    return null;
  } catch (error) {
    console.error(`[PriceResolver] Failed to get current price for ${symbol}:`, error);
    return null;
  }
}

/**
 * Clear price cache
 */
export function clearPriceCache(): void {
  priceCache.clear();
  console.log('[PriceResolver] Cache cleared');
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; oldestEntry: number | null } {
  let oldest: number | null = null;
  
  for (const entry of priceCache.values()) {
    if (oldest === null || entry.timestamp < oldest) {
      oldest = entry.timestamp;
    }
  }
  
  return {
    size: priceCache.size,
    oldestEntry: oldest,
  };
}

console.log('[Phase 5.1] Price Resolver Service loaded');
