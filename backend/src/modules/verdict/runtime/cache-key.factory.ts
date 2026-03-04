/**
 * CACHE KEY FACTORY
 * =================
 * 
 * P3: Block 14 - Cache Key Normalization
 * Produces deterministic, canonical cache keys.
 * 
 * Format: verdict:{symbol}:{horizon}
 * 
 * Prevents cache fragmentation from:
 * - btc vs BTC
 * - 1d vs 1D
 * - whitespace
 * - garbage query params
 */

export type Horizon = '1D' | '7D' | '30D';

const VALID_HORIZONS: Horizon[] = ['1D', '7D', '30D'];

/**
 * Normalize symbol to uppercase, trimmed
 */
export function normalizeSymbol(symbol?: string): string {
  return (symbol || 'BTC')
    .trim()
    .toUpperCase()
    .replace(/USDT$/, '')
    .replace(/-PERP$/, '')
    .replace(/\/USDT$/, '');
}

/**
 * Normalize horizon to valid value
 */
export function normalizeHorizon(horizon?: string): Horizon {
  const h = (horizon || '1D').trim().toUpperCase();
  
  if (VALID_HORIZONS.includes(h as Horizon)) {
    return h as Horizon;
  }
  
  return '1D';
}

/**
 * Build canonical verdict cache key
 * Format: verdict:{SYMBOL}:{HORIZON}
 */
export function buildVerdictCacheKey(symbol?: string, horizon?: string): string {
  const s = normalizeSymbol(symbol);
  const h = normalizeHorizon(horizon);
  
  return `verdict:${s}:${h}`;
}

/**
 * Build cache key with model version (for auto-invalidation on retrain)
 * Format: verdict:{VERSION}:{SYMBOL}:{HORIZON}
 */
export function buildVersionedCacheKey(
  symbol?: string, 
  horizon?: string, 
  modelsVersion?: string
): string {
  const s = normalizeSymbol(symbol);
  const h = normalizeHorizon(horizon);
  const v = modelsVersion || 'v1';
  
  return `verdict:${v}:${s}:${h}`;
}

/**
 * Parse cache key back to components
 */
export function parseCacheKey(key: string): { symbol: string; horizon: Horizon; version?: string } | null {
  // Try versioned format: verdict:{version}:{symbol}:{horizon}
  const vMatch = key.match(/^verdict:([^:]+):([^:]+):([^:]+)$/);
  if (vMatch) {
    return {
      version: vMatch[1],
      symbol: vMatch[2],
      horizon: normalizeHorizon(vMatch[3]),
    };
  }
  
  // Try simple format: verdict:{symbol}:{horizon}
  const sMatch = key.match(/^verdict:([^:]+):([^:]+)$/);
  if (sMatch) {
    return {
      symbol: sMatch[1],
      horizon: normalizeHorizon(sMatch[2]),
    };
  }
  
  return null;
}

console.log('[CacheKeyFactory] Module loaded');
