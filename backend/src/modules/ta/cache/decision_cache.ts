/**
 * Phase N1: Decision Cache
 * 
 * Two-tier caching: L1 Memory (30-90s) + L2 MongoDB (5-15min)
 */

import { Db } from 'mongodb';
import { decisionKey, mtfKey } from './cache_keys.js';

interface MemoryCacheEntry {
  data: any;
  expire: number;
}

// L1 Memory cache
const memoryCache = new Map<string, MemoryCacheEntry>();

// Cache config
export interface CacheConfig {
  l1TtlMs: number;     // Memory TTL (default 30s)
  l2TtlMs: number;     // Mongo TTL (default 300s = 5min)
  enabled: boolean;
}

const DEFAULT_CONFIG: CacheConfig = {
  l1TtlMs: 30000,      // 30 seconds
  l2TtlMs: 300000,     // 5 minutes
  enabled: true,
};

let config = { ...DEFAULT_CONFIG };

/**
 * Update cache config
 */
export function setCacheConfig(cfg: Partial<CacheConfig>): void {
  config = { ...config, ...cfg };
}

/**
 * Get cache config
 */
export function getCacheConfig(): CacheConfig {
  return { ...config };
}

/**
 * Get decision with caching
 */
export async function getDecisionCached<T>(params: {
  db: Db;
  asset: string;
  tf: string;
  compute: () => Promise<T>;
}): Promise<{ data: T; cached: boolean; source: 'L1' | 'L2' | 'COMPUTE' }> {
  const { db, asset, tf, compute } = params;
  
  if (!config.enabled) {
    const data = await compute();
    return { data, cached: false, source: 'COMPUTE' };
  }

  const key = decisionKey(asset, tf);
  const now = Date.now();

  // L1: Check memory cache
  const mem = memoryCache.get(key);
  if (mem && mem.expire > now) {
    return { data: mem.data, cached: true, source: 'L1' };
  }

  // L2: Check MongoDB cache
  try {
    const mongo = await db.collection('ta_cache').findOne({ key });
    
    if (mongo && mongo.expireAt > new Date()) {
      // Populate L1 from L2
      memoryCache.set(key, {
        data: mongo.data,
        expire: now + config.l1TtlMs,
      });
      return { data: mongo.data, cached: true, source: 'L2' };
    }
  } catch (err) {
    console.warn('[Cache] L2 read error:', err);
  }

  // Cache miss: compute and store
  const result = await compute();

  // Store in L1
  memoryCache.set(key, {
    data: result,
    expire: now + config.l1TtlMs,
  });

  // Store in L2
  try {
    await db.collection('ta_cache').updateOne(
      { key },
      {
        $set: {
          key,
          data: result,
          expireAt: new Date(now + config.l2TtlMs),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    console.warn('[Cache] L2 write error:', err);
  }

  return { data: result, cached: false, source: 'COMPUTE' };
}

/**
 * Get MTF decision with caching
 */
export async function getMTFCached<T>(params: {
  db: Db;
  asset: string;
  compute: () => Promise<T>;
}): Promise<{ data: T; cached: boolean; source: 'L1' | 'L2' | 'COMPUTE' }> {
  const { db, asset, compute } = params;
  
  if (!config.enabled) {
    const data = await compute();
    return { data, cached: false, source: 'COMPUTE' };
  }

  const key = mtfKey(asset);
  const now = Date.now();

  // L1: Check memory cache
  const mem = memoryCache.get(key);
  if (mem && mem.expire > now) {
    return { data: mem.data, cached: true, source: 'L1' };
  }

  // L2: Check MongoDB cache
  try {
    const mongo = await db.collection('ta_cache').findOne({ key });
    
    if (mongo && mongo.expireAt > new Date()) {
      memoryCache.set(key, {
        data: mongo.data,
        expire: now + config.l1TtlMs,
      });
      return { data: mongo.data, cached: true, source: 'L2' };
    }
  } catch (err) {
    console.warn('[Cache] L2 read error:', err);
  }

  // Compute and store
  const result = await compute();

  memoryCache.set(key, {
    data: result,
    expire: now + config.l1TtlMs,
  });

  try {
    await db.collection('ta_cache').updateOne(
      { key },
      {
        $set: {
          key,
          data: result,
          expireAt: new Date(now + config.l2TtlMs),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    console.warn('[Cache] L2 write error:', err);
  }

  return { data: result, cached: false, source: 'COMPUTE' };
}

/**
 * Invalidate cache entry
 */
export async function invalidateCache(db: Db, key: string): Promise<void> {
  memoryCache.delete(key);
  try {
    await db.collection('ta_cache').deleteOne({ key });
  } catch (err) {
    console.warn('[Cache] Invalidate error:', err);
  }
}

/**
 * Clear all cache
 */
export async function clearAllCache(db: Db): Promise<{ l1Cleared: number; l2Cleared: number }> {
  const l1Cleared = memoryCache.size;
  memoryCache.clear();
  
  let l2Cleared = 0;
  try {
    const result = await db.collection('ta_cache').deleteMany({});
    l2Cleared = result.deletedCount;
  } catch (err) {
    console.warn('[Cache] Clear L2 error:', err);
  }
  
  return { l1Cleared, l2Cleared };
}

/**
 * Get cache stats
 */
export function getCacheStats(): {
  l1Size: number;
  l1Keys: string[];
  config: CacheConfig;
} {
  return {
    l1Size: memoryCache.size,
    l1Keys: Array.from(memoryCache.keys()),
    config,
  };
}

/**
 * Initialize cache indexes
 */
export async function initCacheIndexes(db: Db): Promise<void> {
  try {
    await db.collection('ta_cache').createIndex(
      { key: 1 },
      { unique: true, background: true }
    );
    await db.collection('ta_cache').createIndex(
      { expireAt: 1 },
      { expireAfterSeconds: 0, background: true }  // TTL index
    );
    console.log('[Cache] Indexes initialized');
  } catch (err) {
    console.error('[Cache] Failed to create indexes:', err);
  }
}
