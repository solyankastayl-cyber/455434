/**
 * HEAVY VERDICT STORE
 * ===================
 * 
 * P3: Smart Caching Layer - Blocks 13, 18, 23, 25-26
 * In-memory cache for heavy ML computations with TTL, LRU, and SWR support.
 * 
 * Features:
 * - Fresh/stale/expired states
 * - Stale-while-revalidate pattern (Block 13, 26)
 * - In-flight request tracking (single-flight)
 * - Auto-pruning of dead entries
 * - LRU eviction when max entries exceeded (Block 18)
 * - Memory safety with configurable limits (Block 18)
 * - Smart TTL per horizon (Block 23)
 * - Stampede protection with getOrCreate (Block 25)
 * 
 * TTL Strategy (Block 23):
 * - 1D: 2 minutes (sensitive to market)
 * - 7D: 5 minutes (moderate)
 * - 30D: 10 minutes (strategic)
 */

import type { CacheEntry, HeavyVerdictPayload, HeavyKey, CacheStats, ForecastHorizon } from './heavy-verdict.types.js';

// Block 23: Smart TTL by horizon
const TTL_BY_HORIZON: Record<ForecastHorizon, number> = {
  '1D': 2 * 60_000,   // 2 minutes - market sensitive
  '7D': 5 * 60_000,   // 5 minutes - moderate
  '30D': 10 * 60_000, // 10 minutes - strategic
};

// Block 18: Memory safety defaults
const DEFAULT_TTL_MS = 5 * 60_000;        // 5 minutes - fresh (fallback)
const DEFAULT_STALE_MS = 30 * 60_000;     // 30 minutes - stale OK
const DEFAULT_MAX_ENTRIES = 300;          // Block 18: LRU limit
const CLEANUP_INTERVAL_MS = 60_000;       // Auto-cleanup every 60s

export class HeavyVerdictStore {
  private map = new Map<string, CacheEntry<HeavyVerdictPayload>>();
  private inFlight = new Map<string, Promise<HeavyVerdictPayload>>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  
  // Metrics
  private hits = 0;
  private misses = 0;
  private sets = 0;
  private evictions = 0;

  constructor(
    private ttlMs = DEFAULT_TTL_MS,
    private staleMs = DEFAULT_STALE_MS,
    private maxEntries = DEFAULT_MAX_ENTRIES
  ) {
    console.log(`[HeavyVerdictStore] Initialized with TTL=${ttlMs}ms, staleMs=${staleMs}ms, maxEntries=${maxEntries}`);
    
    // Block 18: Start auto-cleanup job
    this.startCleanupJob();
  }

  /**
   * Block 18: Start periodic cleanup job
   */
  private startCleanupJob() {
    if (this.cleanupTimer) return;
    
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    
    console.log('[HeavyVerdictStore] Cleanup job started');
  }

  /**
   * Block 18: Cleanup expired entries and enforce LRU
   */
  cleanup(): { removedExpired: number; evictedLRU: number; size: number } {
    const now = Date.now();
    let removedExpired = 0;

    // Remove expired entries
    for (const [k, e] of this.map.entries()) {
      if (now >= e.staleAt) {
        this.map.delete(k);
        removedExpired++;
      }
    }

    // Enforce max entries (LRU eviction)
    const evictedLRU = this.evictIfNeeded();

    if (removedExpired > 0 || evictedLRU > 0) {
      console.log(`[HeavyVerdictStore] Cleanup: expired=${removedExpired}, lru=${evictedLRU}, size=${this.map.size}`);
    }

    return { removedExpired, evictedLRU, size: this.map.size };
  }

  /**
   * Block 18: LRU eviction when over max entries
   */
  private evictIfNeeded(): number {
    let evicted = 0;
    
    while (this.map.size > this.maxEntries) {
      // Map maintains insertion order, first key is oldest (LRU)
      const oldestKey = this.map.keys().next().value;
      if (!oldestKey) break;
      
      this.map.delete(oldestKey);
      evicted++;
      this.evictions++;
    }
    
    return evicted;
  }

  /**
   * Block 23: Get TTL based on horizon
   */
  getTTLForHorizon(horizon?: ForecastHorizon): number {
    if (horizon && TTL_BY_HORIZON[horizon]) {
      return TTL_BY_HORIZON[horizon];
    }
    return this.ttlMs;
  }

  /**
   * Block 23: Get stale window based on horizon (6x TTL)
   */
  getStaleForHorizon(horizon?: ForecastHorizon): number {
    return this.getTTLForHorizon(horizon) * 6;
  }

  /**
   * Build cache key from symbol and horizon
   */
  makeKey(k: HeavyKey): string {
    return `symbol:${k.symbol.toUpperCase()}|h:${k.horizon}`;
  }

  /**
   * Block 13: Check if cache entry is fresh (TTL not expired)
   */
  isFresh(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    return Date.now() <= e.expiresAt;
  }

  /**
   * Get fresh entry only (returns null if expired)
   */
  getFresh(key: string): HeavyVerdictPayload | null {
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return null;
    }
    if (Date.now() > e.expiresAt) {
      this.misses++;
      return null;
    }
    
    // Block 18: Update LRU by reinserting (Map maintains insertion order)
    this.touchLRU(key, e);
    
    this.hits++;
    return e.value;
  }

  /**
   * Block 18: Touch entry to mark as recently used (LRU update)
   */
  private touchLRU(key: string, entry: CacheEntry<HeavyVerdictPayload>) {
    // Reinsert to update Map order (most recent at end)
    this.map.delete(key);
    entry.lastAccessAt = Date.now();
    this.map.set(key, entry);
  }

  /**
   * Get entry with stale tolerance (for stale-while-revalidate)
   * Returns value even if stale (but not if fully expired past staleAt)
   * Block 13, 26: Core SWR implementation
   */
  getStaleOk(key: string): { value: HeavyVerdictPayload | null; isStale: boolean; ageMs: number } {
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return { value: null, isStale: false, ageMs: 0 };
    }
    
    const now = Date.now();
    const ageMs = now - e.createdAt;
    
    // Fresh
    if (now <= e.expiresAt) {
      this.touchLRU(key, e);
      this.hits++;
      return { value: e.value, isStale: false, ageMs };
    }
    
    // Stale but usable (Block 13: return old + trigger async refresh)
    if (now <= e.staleAt) {
      this.touchLRU(key, e);
      this.hits++;
      return { value: e.value, isStale: true, ageMs };
    }
    
    // Dead - beyond stale window
    this.misses++;
    return { value: null, isStale: false, ageMs };
  }

  /**
   * Block 25: Get or create with stampede protection
   * Guarantees single computation even with concurrent requests
   */
  async getOrCreate(
    key: string, 
    factory: () => Promise<HeavyVerdictPayload>,
    horizon?: ForecastHorizon
  ): Promise<HeavyVerdictPayload> {
    // 1. Check fresh cache
    const cached = this.getFresh(key);
    if (cached) return cached;

    // 2. Check if already computing (stampede protection)
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    // 3. Start new computation
    const ttl = this.getTTLForHorizon(horizon);
    const stale = this.getStaleForHorizon(horizon);

    const p = (async () => {
      try {
        const v = await factory();
        this.set(key, v, ttl, stale);
        return v;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, p);
    return p;
  }

  /**
   * Block 26: Get with SWR - returns stale immediately + triggers background refresh
   */
  async getWithSWR(
    key: string,
    factory: () => Promise<HeavyVerdictPayload>,
    horizon?: ForecastHorizon
  ): Promise<HeavyVerdictPayload> {
    const cached = this.map.get(key);
    const now = Date.now();

    // 1. Fresh - return immediately
    if (cached && now <= cached.expiresAt) {
      this.touchLRU(key, cached);
      this.hits++;
      return cached.value;
    }

    // 2. Stale - return immediately + refresh in background
    if (cached && now <= cached.staleAt) {
      this.touchLRU(key, cached);
      this.hits++;
      
      // Trigger background refresh if not already in progress
      if (!this.inFlight.has(key)) {
        this.revalidateInBackground(key, factory, horizon);
      }
      
      return cached.value;
    }

    // 3. No cache or dead - compute synchronously (with stampede protection)
    return this.getOrCreate(key, factory, horizon);
  }

  /**
   * Block 26: Background revalidation (async, doesn't block)
   */
  private revalidateInBackground(
    key: string,
    factory: () => Promise<HeavyVerdictPayload>,
    horizon?: ForecastHorizon
  ): void {
    const ttl = this.getTTLForHorizon(horizon);
    const stale = this.getStaleForHorizon(horizon);

    const p = (async () => {
      try {
        const fresh = await factory();
        this.set(key, fresh, ttl, stale);
        return fresh;
      } catch (e: any) {
        console.warn(`[HeavyVerdictStore] Background refresh failed for ${key}:`, e.message);
        // Keep old value, don't update cache
        return this.map.get(key)?.value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, p);
  }

  /**
   * Store a new cache entry
   * Block 23: Uses horizon-aware TTL
   */
  set(key: string, value: HeavyVerdictPayload, customTtlMs?: number, customStaleMs?: number) {
    const now = Date.now();
    const ttl = customTtlMs ?? this.ttlMs;
    const stale = customStaleMs ?? this.staleMs;
    
    // Block 18: Remove existing entry first (for LRU ordering)
    if (this.map.has(key)) this.map.delete(key);
    
    const entry: CacheEntry<HeavyVerdictPayload> = {
      key,
      value,
      createdAt: now,
      expiresAt: now + ttl,
      staleAt: now + stale,
      lastAccessAt: now,
    };
    
    this.map.set(key, entry);
    this.sets++;
    
    // Block 18: Enforce max entries after insert
    this.evictIfNeeded();
    
    console.log(`[HeavyVerdictStore] SET ${key}, computeMs=${value.computeMs}ms, ttl=${ttl}ms`);
  }

  /**
   * Block 23: Set with horizon-aware TTL
   */
  setWithHorizon(key: string, value: HeavyVerdictPayload, horizon: ForecastHorizon) {
    const ttl = this.getTTLForHorizon(horizon);
    const stale = this.getStaleForHorizon(horizon);
    this.set(key, value, ttl, stale);
  }

  /**
   * Block 15: Invalidate entry (event-based invalidation)
   */
  invalidate(key: string): boolean {
    return this.map.delete(key);
  }

  /**
   * Delete a specific key
   */
  delete(key: string): number {
    return this.map.delete(key) ? 1 : 0;
  }

  /**
   * Delete all entries matching a prefix
   */
  deleteByPrefix(prefix: string): number {
    let removed = 0;
    for (const k of this.map.keys()) {
      if (k.startsWith(prefix)) {
        if (this.map.delete(k)) removed++;
      }
    }
    return removed;
  }

  /**
   * Block 13: Mark entry as computing (for tracking)
   */
  markComputing(key: string): void {
    // Already tracked via inFlight map
    console.log(`[HeavyVerdictStore] Computing: ${key}`);
  }

  /**
   * Block 13: Clear computing flag
   */
  clearComputing(key: string): void {
    this.inFlight.delete(key);
  }

  /**
   * Block 13: Check if key is currently being computed
   */
  isComputing(key: string): boolean {
    return this.inFlight.has(key);
  }

  /**
   * Check if entry is near expiry (for proactive refresh)
   */
  isNearExpiry(key: string, refreshWindowMs: number = 60_000): boolean {
    const e = this.map.get(key);
    if (!e) return true;
    return Date.now() + refreshWindowMs > e.expiresAt;
  }

  /**
   * Get in-flight computation promise (for single-flight)
   */
  getInFlight(key: string): Promise<HeavyVerdictPayload> | null {
    return this.inFlight.get(key) || null;
  }

  /**
   * Set in-flight computation promise
   */
  setInFlight(key: string, promise: Promise<HeavyVerdictPayload>) {
    this.inFlight.set(key, promise);
  }

  /**
   * Clear in-flight promise after completion
   */
  clearInFlight(key: string) {
    this.inFlight.delete(key);
  }

  /**
   * Get all cache keys
   */
  keys(): string[] {
    return Array.from(this.map.keys());
  }

  /**
   * Get cache statistics (Block 18: includes LRU stats)
   */
  stats(): CacheStats & { maxEntries: number; evictions: number } {
    const now = Date.now();
    let fresh = 0, stale = 0, dead = 0;
    
    for (const e of this.map.values()) {
      if (now <= e.expiresAt) fresh++;
      else if (now <= e.staleAt) stale++;
      else dead++;
    }
    
    return {
      total: this.map.size,
      fresh,
      stale,
      dead,
      ttlMs: this.ttlMs,
      staleMs: this.staleMs,
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      maxEntries: this.maxEntries,
      evictions: this.evictions,
      inFlight: this.inFlight.size,
    };
  }

  /**
   * Remove all expired entries (garbage collection)
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    
    for (const [k, e] of this.map.entries()) {
      if (now > e.staleAt) {
        this.map.delete(k);
        pruned++;
      }
    }
    
    if (pruned > 0) {
      console.log(`[HeavyVerdictStore] Pruned ${pruned} dead entries`);
    }
    return pruned;
  }

  /**
   * Clear all entries
   */
  clear() {
    const size = this.map.size;
    this.map.clear();
    this.inFlight.clear();
    console.log(`[HeavyVerdictStore] Cleared ${size} entries`);
  }

  /**
   * Block 18: Stop cleanup job (for graceful shutdown)
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('[HeavyVerdictStore] Cleanup job stopped');
    }
  }
}

// Singleton instance
export const heavyVerdictStore = new HeavyVerdictStore();

console.log('[HeavyVerdictStore] Module loaded (Blocks 13, 18, 23, 25-26)');
