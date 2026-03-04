/**
 * LRU CACHE
 * =========
 * 
 * P3: Smart Caching Layer - Block 15
 * LRU (Least Recently Used) eviction cache with TTL support.
 * 
 * Features:
 * - Maximum size limit (memory guard)
 * - LRU eviction when at capacity
 * - TTL support (entries expire after timeout)
 * - Stale entries can be served while refreshing
 */

type LruEntry<T> = {
  key: string;
  value: T;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
};

export class LruCache<T> {
  private map = new Map<string, LruEntry<T>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    private maxSize: number,
    private defaultTtlMs: number
  ) {
    console.log(`[LruCache] Initialized with maxSize=${maxSize}, ttlMs=${defaultTtlMs}`);
  }

  /**
   * Get value if exists and not expired
   */
  get(key: string): T | null {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      this.misses++;
      return null;
    }

    // Update access time (LRU)
    entry.lastAccessedAt = Date.now();
    this.hits++;
    return entry.value;
  }

  /**
   * Set value with optional TTL
   */
  set(key: string, value: T, ttlMs?: number) {
    const now = Date.now();
    const ttl = ttlMs ?? this.defaultTtlMs;

    // Check if at capacity
    if (this.map.size >= this.maxSize && !this.map.has(key)) {
      this.evictLru();
    }

    this.map.set(key, {
      key,
      value,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + ttl,
    });
  }

  /**
   * Delete a specific key
   */
  delete(key: string): boolean {
    return this.map.delete(key);
  }

  /**
   * Clear all entries
   */
  clear() {
    this.map.clear();
  }

  /**
   * Get current size
   */
  size(): number {
    return this.map.size;
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.map.keys());
  }

  /**
   * Get cache statistics
   */
  stats() {
    const now = Date.now();
    let expired = 0;
    for (const entry of this.map.values()) {
      if (now > entry.expiresAt) expired++;
    }

    return {
      size: this.map.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expired,
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
    for (const [key, entry] of this.map.entries()) {
      if (now > entry.expiresAt) {
        this.map.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Evict least recently used entry
   */
  private evictLru(): void {
    let oldest: LruEntry<T> | null = null;
    let oldestTime = Infinity;

    for (const entry of this.map.values()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldest = entry;
      }
    }

    if (oldest) {
      this.map.delete(oldest.key);
      this.evictions++;
    }
  }
}

console.log('[LruCache] Module loaded');
