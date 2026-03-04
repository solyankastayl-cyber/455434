/**
 * ENGINE CACHE — P5.2
 * 
 * Simple in-memory cache for expensive calculations.
 * TTL-based, reduces Engine latency from 40s to <500ms.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class EngineCache {
  private cache = new Map<string, CacheEntry<any>>();
  
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }
  
  set<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    });
  }
  
  invalidate(pattern?: string): number {
    if (!pattern) {
      const count = this.cache.size;
      this.cache.clear();
      return count;
    }
    
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }
  
  stats(): { entries: number; keys: string[] } {
    return {
      entries: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

export const engineCache = new EngineCache();

// Cache TTLs
export const CACHE_TTL = {
  CASCADE: 5 * 60 * 1000,      // 5 minutes for cascade results
  MACRO: 10 * 60 * 1000,       // 10 minutes for macro score
  LIQUIDITY: 10 * 60 * 1000,   // 10 minutes for liquidity
  GUARD: 2 * 60 * 1000,        // 2 minutes for guard (more volatile)
  AE: 5 * 60 * 1000,           // 5 minutes for AE terminal
  DXY: 5 * 60 * 1000,          // 5 minutes for DXY terminal
  ENGINE: 60 * 1000,           // 1 minute for full engine result
};

export function buildCacheKey(endpoint: string, asOf?: string): string {
  return asOf ? `${endpoint}:${asOf}` : `${endpoint}:current`;
}
