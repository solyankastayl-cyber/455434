/**
 * Redis Client - Safe wrapper with graceful fallback
 * 
 * If Redis is not available, the application continues to work
 * without caching (all requests go directly to MongoDB).
 */
import Redis from 'ioredis';

const enabled = String(process.env.REDIS_ENABLED || 'false').toLowerCase() === 'true';

export const redisEnabled = enabled;

export const redis = enabled
  ? new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5000,
      retryStrategy: (times) => {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 200, 1000);
      },
    })
  : null;

// Track connection status
let isReady = false;

if (redis) {
  redis.on('ready', () => {
    isReady = true;
    console.log('[Redis] Connected and ready');
  });
  
  redis.on('error', (err) => {
    isReady = false;
    console.warn('[Redis] Connection error:', err.message);
  });
  
  redis.on('close', () => {
    isReady = false;
  });
}

export async function ensureRedisReady(): Promise<boolean> {
  if (!redis) return false;
  
  if (isReady) return true;
  
  try {
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      await redis.connect();
    }
    await redis.ping();
    isReady = true;
    return true;
  } catch {
    isReady = false;
    return false;
  }
}

export function getRedisStatus(): { enabled: boolean; ready: boolean } {
  return { enabled: redisEnabled, ready: isReady };
}
