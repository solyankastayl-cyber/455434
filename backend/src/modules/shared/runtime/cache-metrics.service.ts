/**
 * CACHE METRICS SERVICE
 * =====================
 * 
 * P3: Smart Caching Layer - Block 16
 * Centralized metrics and observability for all caches.
 * 
 * Collects:
 * - Hit rate
 * - Miss rate
 * - Average compute time
 * - In-flight count
 * - TTL hit ratio
 * - Memory usage estimation
 */

import { heavyVerdictStore } from '../../verdict/runtime/heavy-verdict.store.js';
import { mlMicroCache } from '../../verdict/runtime/ml-micro-cache.service.js';
import { verdictStabilityGuard } from '../../verdict/runtime/verdict-stability.guard.js';
import { requestCoalescer } from './request-coalescer.js';

type ComputeTimeSample = {
  key: string;
  ms: number;
  ts: number;
};

type CacheEventType = 'HIT' | 'HIT_STALE' | 'MISS';

type CacheEvent = {
  key: string;
  type: CacheEventType;
  ts: number;
};

class CacheMetricsService {
  private computeTimes: ComputeTimeSample[] = [];
  private cacheEvents: CacheEvent[] = [];
  private readonly maxSamples = 100;
  private readonly maxEvents = 500;

  // Counters for detailed tracking
  private hitsFresh = 0;
  private hitsStale = 0;
  private missesTotal = 0;

  /**
   * Record a compute time sample
   */
  recordComputeTime(key: string, ms: number) {
    this.computeTimes.push({
      key,
      ms,
      ts: Date.now(),
    });

    // Keep only recent samples
    if (this.computeTimes.length > this.maxSamples) {
      this.computeTimes.shift();
    }
  }

  /**
   * Block 16: Record cache hit (fresh or stale)
   */
  recordCacheHit(key: string, isStale: boolean = false) {
    if (isStale) {
      this.hitsStale++;
    } else {
      this.hitsFresh++;
    }

    this.cacheEvents.push({
      key,
      type: isStale ? 'HIT_STALE' : 'HIT',
      ts: Date.now(),
    });

    if (this.cacheEvents.length > this.maxEvents) {
      this.cacheEvents.shift();
    }
  }

  /**
   * Block 16: Record cache miss
   */
  recordCacheMiss(key: string) {
    this.missesTotal++;

    this.cacheEvents.push({
      key,
      type: 'MISS',
      ts: Date.now(),
    });

    if (this.cacheEvents.length > this.maxEvents) {
      this.cacheEvents.shift();
    }
  }

  /**
   * Get aggregated metrics from all caches
   */
  getMetrics() {
    // Heavy verdict store metrics
    const heavyStats = heavyVerdictStore.stats();

    // ML micro cache metrics
    const mlStats = mlMicroCache.stats();

    // Stability guard metrics
    const stabilityStats = verdictStabilityGuard.stats();

    // Coalescer metrics
    const coalescerStats = {
      inFlight: requestCoalescer.size(),
      keys: requestCoalescer.keys(),
    };

    // Compute time metrics
    const computeTimeMetrics = this.computeTimeMetrics();

    // Block 16: Detailed hit/miss breakdown
    const detailedMetrics = {
      hitsFresh: this.hitsFresh,
      hitsStale: this.hitsStale,
      missesTotal: this.missesTotal,
      swrEfficiency: this.hitsStale + this.hitsFresh > 0
        ? Math.round((this.hitsStale / (this.hitsStale + this.hitsFresh)) * 100)
        : 0,
    };

    return {
      heavyVerdictCache: heavyStats,
      mlMicroCache: mlStats,
      stabilityGuard: stabilityStats,
      coalescer: coalescerStats,
      computeTimes: computeTimeMetrics,
      detailedMetrics,
      recentEvents: this.cacheEvents.slice(-20),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Calculate compute time metrics
   */
  private computeTimeMetrics() {
    if (this.computeTimes.length === 0) {
      return {
        avgMs: 0,
        minMs: 0,
        maxMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        samples: 0,
      };
    }

    const times = this.computeTimes.map(s => s.ms).sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const len = times.length;

    return {
      avgMs: Math.round(sum / len),
      minMs: times[0],
      maxMs: times[len - 1],
      p50Ms: times[Math.floor(len * 0.5)],
      p95Ms: times[Math.floor(len * 0.95)],
      samples: len,
    };
  }

  /**
   * Get summary for quick health check
   */
  getSummary() {
    const heavyStats = heavyVerdictStore.stats();
    const mlStats = mlMicroCache.stats();
    const computeMetrics = this.computeTimeMetrics();

    const totalHits = heavyStats.hits + mlStats.hits;
    const totalMisses = heavyStats.misses + mlStats.misses;
    const totalRequests = totalHits + totalMisses;
    const overallHitRate = totalRequests > 0
      ? Math.round((totalHits / totalRequests) * 100)
      : 0;

    return {
      status: 'OK',
      caches: {
        heavy: {
          entries: heavyStats.total,
          fresh: heavyStats.fresh,
          hitRate: heavyStats.hits + heavyStats.misses > 0
            ? Math.round((heavyStats.hits / (heavyStats.hits + heavyStats.misses)) * 100)
            : 0,
        },
        ml: {
          entries: mlStats.size,
          hitRate: mlStats.hits + mlStats.misses > 0
            ? Math.round((mlStats.hits / (mlStats.hits + mlStats.misses)) * 100)
            : 0,
        },
      },
      overall: {
        hitRate: overallHitRate,
        avgComputeMs: computeMetrics.avgMs,
        p95ComputeMs: computeMetrics.p95Ms,
        inFlight: requestCoalescer.size(),
      },
    };
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.computeTimes = [];
    this.cacheEvents = [];
    this.hitsFresh = 0;
    this.hitsStale = 0;
    this.missesTotal = 0;
  }
}

// Singleton instance
export const cacheMetricsService = new CacheMetricsService();

console.log('[CacheMetricsService] Module loaded (Block 16)');
