/**
 * ML MICRO CACHE SERVICE
 * ======================
 * 
 * P3: Smart Caching Layer - Block 4
 * Micro-cache for ML feature extraction and model outputs.
 * 
 * Caches:
 * - Feature matrix (40+ indicators)
 * - Model inference results (1D/7D/30D)
 * 
 * Key includes regime version to auto-invalidate when market regime changes.
 * TTL: 90 seconds (shorter than heavy verdict cache)
 * 
 * IMPORTANT: This cache is ONLY for read-path (UI).
 * Auto-learning/training does NOT use this cache.
 */

import { TtlCache } from '../../shared/runtime/ttl-cache.js';
import { RequestCoalescer } from '../../shared/runtime/request-coalescer.js';

type MlOutput = {
  rawConfidence: number;
  expectedMovePct: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  featuresSnapshot: Record<string, number>;
  modelId: string;
  horizon: string;
};

const DEFAULT_TTL_MS = 90_000; // 90 seconds

export class MlMicroCacheService {
  private cache: TtlCache<MlOutput>;
  private coalescer = new RequestCoalescer();

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.cache = new TtlCache<MlOutput>(ttlMs);
    console.log(`[MlMicroCache] Initialized with TTL=${ttlMs}ms`);
  }

  /**
   * Build cache key including regime version for auto-invalidation
   */
  buildKey(
    symbol: string,
    horizon: string,
    regimeVersion: string
  ): string {
    return `ml:${symbol.toUpperCase()}:${horizon}:${regimeVersion}`;
  }

  /**
   * Build regime version string from market state
   * Changes in regime will auto-invalidate cache
   */
  buildRegimeVersion(
    macroRegime?: string,
    fundingCrowdedness?: number,
    fundingZ?: number,
    volatilityRegime?: string
  ): string {
    return [
      macroRegime || 'NEUTRAL',
      fundingCrowdedness?.toFixed(2) || '0.00',
      fundingZ?.toFixed(2) || '0.00',
      volatilityRegime || 'NORMAL',
    ].join('|');
  }

  /**
   * Get or compute ML output with caching and coalescing
   */
  async getOrCompute(
    key: string,
    compute: () => Promise<MlOutput>
  ): Promise<MlOutput> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    // Use coalescer to prevent duplicate computations
    return this.coalescer.run(key, async () => {
      // Double-check cache after acquiring "lock"
      const again = this.cache.get(key);
      if (again) return again;

      // Compute and cache
      const result = await compute();
      this.cache.set(key, result);
      return result;
    });
  }

  /**
   * Clear all cached entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  stats() {
    return {
      ...this.cache.stats(),
      coalescer: {
        inFlight: this.coalescer.size(),
        keys: this.coalescer.keys(),
      },
    };
  }

  /**
   * Prune expired entries
   */
  prune(): number {
    return this.cache.prune();
  }
}

// Singleton instance
export const mlMicroCache = new MlMicroCacheService();

console.log('[MlMicroCacheService] Module loaded');
