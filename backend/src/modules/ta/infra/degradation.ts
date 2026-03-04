/**
 * Phase S5: Safe Degradation
 * Fallback and insufficient data handling
 */

import { getConfig } from './config.js';
import { getCandleCache, candleCacheKey } from './cache.js';

export type DataSource = 'LIVE' | 'STALE_CACHE' | 'MOCK';

export interface DataStatus {
  source: DataSource;
  isStale: boolean;
  stalenessSec: number;
  candleCount: number;
  sufficient: boolean;
  requiredCandles: number;
}

/**
 * Insufficient data response
 */
export interface InsufficientDataResult {
  status: 'INSUFFICIENT_DATA';
  required: number;
  received: number;
  message: string;
}

/**
 * Check if we have sufficient candles
 */
export function checkSufficientData(
  candleCount: number,
  minRequired?: number
): { sufficient: boolean; required: number } {
  const config = getConfig();
  const required = minRequired ?? config.minCandlesRequired;
  
  return {
    sufficient: candleCount >= required,
    required,
  };
}

/**
 * Create insufficient data result
 */
export function createInsufficientDataResult(
  received: number,
  required?: number
): InsufficientDataResult {
  const config = getConfig();
  const req = required ?? config.minCandlesRequired;
  
  return {
    status: 'INSUFFICIENT_DATA',
    required: req,
    received,
    message: `Need at least ${req} candles, received ${received}`,
  };
}

/**
 * Try to get candles with fallback to stale cache
 */
export async function getCandlesWithFallback(
  symbol: string,
  tf: string,
  fetchFn: () => Promise<any[]>
): Promise<{
  candles: any[];
  dataStatus: DataStatus;
}> {
  const config = getConfig();
  const cache = getCandleCache();
  const cacheKey = candleCacheKey(symbol, tf, 0, 0);
  
  try {
    // Try live fetch
    const candles = await fetchFn();
    
    // Cache the result
    cache.set(cacheKey, candles);
    
    const sufficiency = checkSufficientData(candles.length);
    
    return {
      candles,
      dataStatus: {
        source: 'LIVE',
        isStale: false,
        stalenessSec: 0,
        candleCount: candles.length,
        sufficient: sufficiency.sufficient,
        requiredCandles: sufficiency.required,
      },
    };
  } catch (error) {
    // Try stale cache fallback
    const entry = cache.getEntry(cacheKey);
    
    if (entry) {
      const stalenessSec = Math.floor((Date.now() - entry.createdAt) / 1000);
      
      if (stalenessSec <= config.staleCacheMaxSec) {
        const candles = entry.data;
        const sufficiency = checkSufficientData(candles?.length || 0);
        
        console.warn(`[Degradation] Using stale cache for ${symbol}:${tf}, staleness=${stalenessSec}s`);
        
        return {
          candles: candles || [],
          dataStatus: {
            source: 'STALE_CACHE',
            isStale: true,
            stalenessSec,
            candleCount: candles?.length || 0,
            sufficient: sufficiency.sufficient,
            requiredCandles: sufficiency.required,
          },
        };
      }
    }
    
    // No fallback available
    console.error(`[Degradation] No fallback available for ${symbol}:${tf}`, error);
    
    return {
      candles: [],
      dataStatus: {
        source: 'LIVE',
        isStale: false,
        stalenessSec: 0,
        candleCount: 0,
        sufficient: false,
        requiredCandles: config.minCandlesRequired,
      },
    };
  }
}

/**
 * Wrap analysis result with data status
 */
export function wrapWithDataStatus<T>(
  result: T,
  dataStatus: DataStatus
): T & { dataStatus: DataStatus } {
  return {
    ...result,
    dataStatus,
  };
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: any): boolean {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    return true;
  }
  
  // HTTP 5xx errors
  if (error.status >= 500 && error.status < 600) {
    return true;
  }
  
  // Rate limit (429) - retryable after delay
  if (error.status === 429) {
    return true;
  }
  
  return false;
}

/**
 * Safe wrapper for provider calls
 */
export async function safeProviderCall<T>(
  fn: () => Promise<T>,
  fallbackFn?: () => T
): Promise<{ result: T; error?: Error; usedFallback: boolean }> {
  try {
    const result = await fn();
    return { result, usedFallback: false };
  } catch (error) {
    if (fallbackFn) {
      try {
        const result = fallbackFn();
        return { result, error: error as Error, usedFallback: true };
      } catch (fallbackError) {
        throw error;
      }
    }
    throw error;
  }
}
