/**
 * TTL CACHE
 * =========
 * 
 * P3: Smart Caching Layer - Block 3
 * Universal in-memory TTL cache for fast data access.
 * 
 * Used for:
 * - Price series caching (60s TTL)
 * - Chart payload caching (20s TTL)
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(private defaultTtlMs: number) {}

  /**
   * Get value if not expired
   */
  get(key: string): T | null {
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return null;
    }
    if (Date.now() > e.expiresAt) {
      this.map.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return e.value;
  }

  /**
   * Set value with TTL
   */
  set(key: string, value: T, ttlMs?: number) {
    this.map.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  /**
   * Delete a specific key
   */
  del(key: string) {
    this.map.delete(key);
  }

  /**
   * Clear all entries
   */
  clear() {
    this.map.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.map.size;
  }

  /**
   * Get cache stats
   */
  stats() {
    return {
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? Math.round((this.hits / (this.hits + this.misses)) * 100)
        : 0,
    };
  }

  /**
   * Prune expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [k, e] of this.map.entries()) {
      if (now > e.expiresAt) {
        this.map.delete(k);
        pruned++;
      }
    }
    return pruned;
  }
}

console.log('[TtlCache] Module loaded');
