/**
 * Phase S4.4: Metrics Collector
 * Rolling window metrics for observability
 */

import { getConfig } from './config.js';
import { getCandleCache } from './cache.js';
import { getRateLimiter } from './ratelimit.js';
import { getAllBreakers, BreakerState } from './breaker.js';

interface MetricSample {
  ts: number;
  value: number;
}

interface PhaseLatency {
  samples: MetricSample[];
  sum: number;
  count: number;
}

class MetricsCollector {
  private latencies: Map<string, PhaseLatency> = new Map();
  private errors: MetricSample[] = [];
  private requests: MetricSample[] = [];
  private windowMs: number;
  
  constructor() {
    const config = getConfig();
    this.windowMs = config.metricsWindowSec * 1000;
  }
  
  /**
   * Record latency for a phase
   */
  recordLatency(phase: string, ms: number): void {
    const now = Date.now();
    let entry = this.latencies.get(phase);
    
    if (!entry) {
      entry = { samples: [], sum: 0, count: 0 };
      this.latencies.set(phase, entry);
    }
    
    entry.samples.push({ ts: now, value: ms });
    entry.sum += ms;
    entry.count++;
    
    this.pruneOld(entry.samples);
  }
  
  /**
   * Record provider error
   */
  recordError(): void {
    this.errors.push({ ts: Date.now(), value: 1 });
    this.pruneOld(this.errors);
  }
  
  /**
   * Record request
   */
  recordRequest(): void {
    this.requests.push({ ts: Date.now(), value: 1 });
    this.pruneOld(this.requests);
  }
  
  /**
   * Get average latency for a phase
   */
  getAvgLatency(phase: string): number {
    const entry = this.latencies.get(phase);
    if (!entry || entry.count === 0) return 0;
    
    this.pruneOld(entry.samples);
    if (entry.samples.length === 0) return 0;
    
    const sum = entry.samples.reduce((s, x) => s + x.value, 0);
    return sum / entry.samples.length;
  }
  
  /**
   * Get all average latencies
   */
  getAllLatencies(): Record<string, number> {
    const result: Record<string, number> = {};
    
    for (const [phase, _] of this.latencies) {
      result[phase] = Math.round(this.getAvgLatency(phase) * 100) / 100;
    }
    
    return result;
  }
  
  /**
   * Get error rate (errors per minute)
   */
  getErrorRate(): number {
    this.pruneOld(this.errors);
    const minutes = this.windowMs / 60000;
    return this.errors.length / minutes;
  }
  
  /**
   * Get request rate (requests per minute)
   */
  getRequestRate(): number {
    this.pruneOld(this.requests);
    const minutes = this.windowMs / 60000;
    return this.requests.length / minutes;
  }
  
  /**
   * Get comprehensive metrics snapshot
   */
  getMetrics(): MetricsSnapshot {
    const cache = getCandleCache();
    const cacheStats = cache.getStats();
    
    const rateLimiter = getRateLimiter();
    const rlStats = rateLimiter.getStats();
    
    const breakers = getAllBreakers();
    const breakerStates: Record<string, BreakerState> = {};
    for (const [name, breaker] of breakers) {
      breakerStates[name] = breaker.getState();
    }
    
    return {
      ts: Date.now(),
      windowSec: this.windowMs / 1000,
      
      latency: this.getAllLatencies(),
      
      cache: {
        size: cacheStats.size,
        maxKeys: cacheStats.maxKeys,
        hitRate: Math.round(cacheStats.hitRate * 1000) / 1000,
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        evictions: cacheStats.evictions,
      },
      
      rateLimit: {
        allowed: rlStats.allowed,
        rejected: rlStats.rejected,
        queued: rlStats.queued,
        rps: rlStats.rps,
      },
      
      breakers: breakerStates,
      
      errors: {
        count: this.errors.length,
        ratePerMin: Math.round(this.getErrorRate() * 100) / 100,
      },
      
      requests: {
        count: this.requests.length,
        ratePerMin: Math.round(this.getRequestRate() * 100) / 100,
      },
    };
  }
  
  /**
   * Reset all metrics
   */
  reset(): void {
    this.latencies.clear();
    this.errors = [];
    this.requests = [];
  }
  
  private pruneOld(samples: MetricSample[]): void {
    const cutoff = Date.now() - this.windowMs;
    while (samples.length > 0 && samples[0].ts < cutoff) {
      samples.shift();
    }
  }
}

export interface MetricsSnapshot {
  ts: number;
  windowSec: number;
  latency: Record<string, number>;
  cache: {
    size: number;
    maxKeys: number;
    hitRate: number;
    hits: number;
    misses: number;
    evictions: number;
  };
  rateLimit: {
    allowed: number;
    rejected: number;
    queued: number;
    rps: number;
  };
  breakers: Record<string, BreakerState>;
  errors: {
    count: number;
    ratePerMin: number;
  };
  requests: {
    count: number;
    ratePerMin: number;
  };
}

// Singleton
let metricsCollector: MetricsCollector | null = null;

export function getMetrics(): MetricsCollector {
  if (!metricsCollector) {
    metricsCollector = new MetricsCollector();
  }
  return metricsCollector;
}
