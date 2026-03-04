/**
 * Cache module exports
 */
export { 
  cache, 
  get, set, getOrSet, getOrStaleThenRefresh,
  del, invalidate, flush, stats,
  getWithStatus, setWithMeta, acquireLock, releaseLock,
  type CacheStatus, type CacheResult, type CacheMeta
} from './cache.service.js';
export { redis, redisEnabled, ensureRedisReady, getRedisStatus } from './redis.client.js';
