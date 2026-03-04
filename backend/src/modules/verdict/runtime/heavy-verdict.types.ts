/**
 * HEAVY VERDICT TYPES
 * ===================
 * 
 * P3: Smart Caching Layer - Blocks 13, 18, 23, 25-26
 * Types for heavy ML computation caching.
 * 
 * Heavy Key: symbol + horizon (chartRange NOT included - heavy verdict is chart-independent)
 * Heavy Payload: Full verdict with ML outputs, cached for fast retrieval
 * 
 * Features:
 * - TTL Auto-Refresh (Block 13)
 * - LRU eviction (Block 18)
 * - Smart TTL per horizon (Block 23)
 * - Stampede protection (Block 25)
 * - Stale-while-revalidate (Block 26)
 */

export type ForecastHorizon = '1D' | '7D' | '30D';
export type ChartRange = '24h' | '7d' | '30d' | '90d';

/**
 * Cache key components for heavy verdict
 * Note: chartRange is NOT part of the key because heavy ML computation
 * is independent of the chart display range
 */
export type HeavyKey = {
  symbol: string;           // BTC, ETH, SOL...
  horizon: ForecastHorizon; // 1D/7D/30D
};

/**
 * Payload stored in heavy cache
 * Contains all ML-intensive computation results
 */
export type HeavyVerdictPayload = {
  symbol: string;
  horizon: ForecastHorizon;

  // Full verdict from Verdict Engine
  verdict: any;

  // Optional: exchange layer predictions + features
  layers?: any;

  // Optional: model outputs for all horizons
  candidates?: any[];

  // Computation metadata
  computedAt: string;   // ISO timestamp
  computeMs: number;    // Time taken for computation
};

/**
 * Generic cache entry with TTL and stale support
 * Block 18: Added lastAccessAt for LRU tracking
 */
export type CacheEntry<T> = {
  key: string;
  value: T;
  createdAt: number;     // ms timestamp
  expiresAt: number;     // hard TTL: after this, don't use
  staleAt: number;       // soft TTL: can still use, but refresh in background
  lastAccessAt?: number; // Block 18: LRU tracking
};

/**
 * Cache statistics for monitoring
 * Block 18: Added LRU stats
 */
export type CacheStats = {
  total: number;
  fresh: number;
  stale: number;
  dead: number;
  ttlMs: number;
  staleMs: number;
  hits: number;
  misses: number;
  sets: number;
  maxEntries?: number;  // Block 18: LRU limit
  evictions?: number;   // Block 18: LRU evictions count
  inFlight?: number;    // In-flight computations
};

console.log('[HeavyVerdictTypes] Types loaded (Blocks 13, 18, 23, 25-26)');
