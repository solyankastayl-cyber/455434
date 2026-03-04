/**
 * Advanced Cache Service - Stale-While-Revalidate + Lock protection
 * 
 * Features:
 * - SWR pattern: return stale data immediately, refresh in background
 * - Lock protection: prevent cache stampede
 * - Status tracking: READY/EMPTY/STALE/TIMEOUT
 */
import { redis, ensureRedisReady, redisEnabled } from './redis.client.js';

const PREFIX = process.env.REDIS_PREFIX || 'fomo';

function makeKey(k: string): string {
  return `${PREFIX}:${k}`;
}

function makeLockKey(k: string): string {
  return `${PREFIX}:lock:${k}`;
}

function makeMetaKey(k: string): string {
  return `${PREFIX}:meta:${k}`;
}

// Cache entry status
export type CacheStatus = 'READY' | 'EMPTY' | 'STALE' | 'TIMEOUT' | 'REFRESHING';

interface CacheMeta {
  status: CacheStatus;
  createdAt: number;
  ttl: number;
  staleTtl: number;
}

interface CacheResult<T> {
  data: T | null;
  status: CacheStatus;
  fromCache: boolean;
  age: number; // seconds since cached
}

export const cache = {
  enabled: () => redisEnabled,

  /**
   * Basic get from cache
   */
  async get<T>(k: string): Promise<T | null> {
    if (!redis) return null;
    
    const ok = await ensureRedisReady();
    if (!ok) return null;

    try {
      const v = await redis.get(makeKey(k));
      return v ? (JSON.parse(v) as T) : null;
    } catch (err) {
      console.warn('[Cache] Get error:', (err as Error).message);
      return null;
    }
  },

  /**
   * Basic set with TTL
   */
  async set<T>(k: string, value: T, ttlSec: number): Promise<void> {
    if (!redis) return;
    
    const ok = await ensureRedisReady();
    if (!ok) return;

    try {
      await redis.set(makeKey(k), JSON.stringify(value), 'EX', ttlSec);
    } catch (err) {
      console.warn('[Cache] Set error:', (err as Error).message);
    }
  },

  /**
   * Set with metadata (for SWR)
   */
  async setWithMeta<T>(k: string, value: T, ttl: number, staleTtl: number): Promise<void> {
    if (!redis) return;
    
    const ok = await ensureRedisReady();
    if (!ok) return;

    const meta: CacheMeta = {
      status: value !== null ? 'READY' : 'EMPTY',
      createdAt: Date.now(),
      ttl,
      staleTtl,
    };

    try {
      const pipeline = redis.pipeline();
      pipeline.set(makeKey(k), JSON.stringify(value), 'EX', staleTtl);
      pipeline.set(makeMetaKey(k), JSON.stringify(meta), 'EX', staleTtl);
      await pipeline.exec();
    } catch (err) {
      console.warn('[Cache] SetWithMeta error:', (err as Error).message);
    }
  },

  /**
   * Get with status information
   */
  async getWithStatus<T>(k: string): Promise<CacheResult<T>> {
    if (!redis) {
      return { data: null, status: 'EMPTY', fromCache: false, age: 0 };
    }
    
    const ok = await ensureRedisReady();
    if (!ok) {
      return { data: null, status: 'EMPTY', fromCache: false, age: 0 };
    }

    try {
      const [dataStr, metaStr] = await redis.mget(makeKey(k), makeMetaKey(k));
      
      if (!dataStr) {
        return { data: null, status: 'EMPTY', fromCache: false, age: 0 };
      }

      const data = JSON.parse(dataStr) as T;
      const meta = metaStr ? JSON.parse(metaStr) as CacheMeta : null;
      
      const age = meta ? Math.floor((Date.now() - meta.createdAt) / 1000) : 0;
      const isStale = meta ? age > meta.ttl : false;
      
      return {
        data,
        status: isStale ? 'STALE' : (meta?.status || 'READY'),
        fromCache: true,
        age,
      };
    } catch (err) {
      console.warn('[Cache] GetWithStatus error:', (err as Error).message);
      return { data: null, status: 'EMPTY', fromCache: false, age: 0 };
    }
  },

  /**
   * Try to acquire lock (for stampede protection)
   * Returns true if lock acquired, false if already locked
   */
  async acquireLock(k: string, lockTtlSec: number = 30): Promise<boolean> {
    if (!redis) return true; // No redis = no lock needed
    
    const ok = await ensureRedisReady();
    if (!ok) return true;

    try {
      const result = await redis.set(makeLockKey(k), '1', 'EX', lockTtlSec, 'NX');
      return result === 'OK';
    } catch {
      return true; // On error, allow the request
    }
  },

  /**
   * Release lock
   */
  async releaseLock(k: string): Promise<void> {
    if (!redis) return;
    
    try {
      await redis.del(makeLockKey(k));
    } catch {
      // Ignore
    }
  },

  /**
   * Simple cache-aside pattern
   */
  async getOrSet<T>(k: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(k);
    if (cached !== null) {
      return cached;
    }

    const fresh = await fn();
    this.set(k, fresh, ttlSec).catch(() => {});
    return fresh;
  },

  /**
   * Stale-While-Revalidate pattern with lock protection
   * 
   * @param k - cache key
   * @param ttl - fresh TTL in seconds (data considered fresh)
   * @param staleTtl - stale TTL in seconds (data can be served but should refresh)
   * @param fn - function to compute fresh data
   * @param timeout - max time to wait for fresh data before returning stale
   */
  async getOrStaleThenRefresh<T>(
    k: string,
    ttl: number,
    staleTtl: number,
    fn: () => Promise<T>,
    timeout: number = 10000
  ): Promise<CacheResult<T>> {
    // 1. Check cache first
    const cached = await this.getWithStatus<T>(k);
    
    // 2. If fresh data exists, return immediately
    if (cached.data !== null && cached.status === 'READY') {
      return cached;
    }
    
    // 3. If stale data exists, return it and refresh in background
    if (cached.data !== null && cached.status === 'STALE') {
      // Try to acquire lock for background refresh
      const gotLock = await this.acquireLock(k);
      
      if (gotLock) {
        // Background refresh (fire and forget)
        this.refreshInBackground(k, ttl, staleTtl, fn).catch(() => {});
      }
      
      return {
        ...cached,
        status: 'STALE',
      };
    }
    
    // 4. No cache at all - need to fetch fresh
    // Try to acquire lock to prevent stampede
    const gotLock = await this.acquireLock(k);
    
    if (!gotLock) {
      // Another process is fetching, wait a bit and check cache again
      await new Promise(resolve => setTimeout(resolve, 500));
      const retryCache = await this.getWithStatus<T>(k);
      if (retryCache.data !== null) {
        return retryCache;
      }
      // Still nothing, return empty with REFRESHING status
      return { data: null, status: 'REFRESHING', fromCache: false, age: 0 };
    }
    
    // We have the lock, fetch fresh data with timeout
    try {
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), timeout)
      );
      
      const data = await Promise.race([fn(), timeoutPromise]);
      
      // Save to cache with metadata
      await this.setWithMeta(k, data, ttl, staleTtl);
      await this.releaseLock(k);
      
      const isEmpty = data === null || (Array.isArray(data) && data.length === 0) ||
                      (typeof data === 'object' && Object.keys(data as object).length === 0);
      
      return {
        data,
        status: isEmpty ? 'EMPTY' : 'READY',
        fromCache: false,
        age: 0,
      };
    } catch (err) {
      await this.releaseLock(k);
      
      // On timeout/error, check if we have any stale data
      const fallback = await this.get<T>(k);
      if (fallback !== null) {
        return {
          data: fallback,
          status: 'TIMEOUT',
          fromCache: true,
          age: 0,
        };
      }
      
      return {
        data: null,
        status: 'TIMEOUT',
        fromCache: false,
        age: 0,
      };
    }
  },

  /**
   * Refresh cache in background
   */
  async refreshInBackground<T>(
    k: string,
    ttl: number,
    staleTtl: number,
    fn: () => Promise<T>
  ): Promise<void> {
    try {
      const data = await fn();
      await this.setWithMeta(k, data, ttl, staleTtl);
    } catch (err) {
      console.warn(`[Cache] Background refresh failed for ${k}:`, (err as Error).message);
    } finally {
      await this.releaseLock(k);
    }
  },

  /**
   * Delete specific key
   */
  async del(k: string): Promise<void> {
    if (!redis) return;
    
    const ok = await ensureRedisReady();
    if (!ok) return;

    try {
      await redis.del(makeKey(k), makeMetaKey(k));
    } catch (err) {
      console.warn('[Cache] Del error:', (err as Error).message);
    }
  },

  /**
   * Invalidate keys matching a pattern
   */
  async invalidate(pattern: string): Promise<number> {
    if (!redis) return 0;
    
    const ok = await ensureRedisReady();
    if (!ok) return 0;

    const fullPattern = makeKey(pattern);
    const metaPattern = makeMetaKey(pattern);
    let deleted = 0;

    try {
      // Delete data keys
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', fullPattern, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      // Delete meta keys
      cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', metaPattern, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');

      if (deleted > 0) {
        console.log(`[Cache] Invalidated ${deleted} keys matching ${pattern}`);
      }
    } catch (err) {
      console.warn('[Cache] Invalidate error:', (err as Error).message);
    }

    return deleted;
  },

  /**
   * Flush all cache
   */
  async flush(): Promise<void> {
    await this.invalidate('*');
  },

  /**
   * Get cache statistics
   */
  async stats(): Promise<{ enabled: boolean; ready: boolean; keyCount: number }> {
    const enabled = redisEnabled;
    const ready = await ensureRedisReady();
    let keyCount = 0;

    if (ready && redis) {
      try {
        const keys = await redis.keys(makeKey('*'));
        keyCount = keys.length;
      } catch {
        // ignore
      }
    }

    return { enabled, ready, keyCount };
  },
};

// Export types and functions
export type { CacheResult, CacheMeta };
export const { 
  get, set, getOrSet, getOrStaleThenRefresh, 
  del, invalidate, flush, stats,
  getWithStatus, setWithMeta, acquireLock, releaseLock
} = cache;
