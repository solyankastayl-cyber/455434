/**
 * Phase S2.1: LRU Cache with TTL
 * For caching candles/provider responses
 */

import { getConfig } from './config.js';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxKeys: number;
  private defaultTtlMs: number;
  
  // Metrics
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  
  constructor(maxKeys?: number, defaultTtlSec?: number) {
    const config = getConfig();
    this.maxKeys = maxKeys ?? config.cacheMaxKeys;
    this.defaultTtlMs = (defaultTtlSec ?? config.cacheTtlSec) * 1000;
  }
  
  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      return null;
    }
    
    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    this.hits++;
    return entry.data;
  }
  
  /**
   * Get entry with metadata (for staleness check)
   */
  getEntry(key: string): CacheEntry<T> | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // Move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry;
  }
  
  /**
   * Set value in cache
   */
  set(key: string, data: T, ttlMs?: number): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxKeys) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        this.evictions++;
      }
    }
    
    const now = Date.now();
    this.cache.set(key, {
      data,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
      createdAt: now,
    });
  }
  
  /**
   * Delete entry
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }
  
  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }
  
  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxKeys: number;
    hits: number;
    misses: number;
    evictions: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxKeys: this.maxKeys,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
  
  /**
   * Prune expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }
    
    return pruned;
  }
}

// Singleton instance for candle caching
let candleCache: LRUCache<any> | null = null;

export function getCandleCache(): LRUCache<any> {
  if (!candleCache) {
    candleCache = new LRUCache();
  }
  return candleCache;
}

/**
 * Generate cache key for candles
 */
export function candleCacheKey(symbol: string, tf: string, start: number, end: number): string {
  return `candles:${symbol}:${tf}:${start}:${end}`;
}
