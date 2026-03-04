/**
 * P2.3.1: Snapshot Cache Service
 * 
 * Advanced caching for graph snapshots with:
 * - Versioned cache keys (mode + calibrationVersion)
 * - TTL strategy (raw vs calibrated)
 * - In-memory LRU for hot paths
 * - Cache metrics
 * 
 * INVARIANT: Calibration is NEVER re-run on cache hit
 */

import { GraphSnapshot } from '../storage/graph_types.js';
import { 
  GraphSnapshotModel, 
  getCachedSnapshot as dbGetCachedSnapshot,
  saveSnapshot as dbSaveSnapshot 
} from '../storage/graph_snapshot.model.js';

// ============================================
// Configuration
// ============================================

/** Current calibration version - bump to invalidate all calibrated caches */
export const CALIBRATION_VERSION = 'P2.2-Phase2';

/** TTL configuration in milliseconds */
export const TTL_CONFIG = {
  RAW: 5 * 60 * 1000,         // 5 minutes for raw
  CALIBRATED: 30 * 60 * 1000, // 30 minutes for calibrated
};

/** In-memory LRU cache config */
const LRU_CONFIG = {
  MAX_ENTRIES: 50,
  ENABLED: false, // DISABLED FOR DEBUGGING
};

// ============================================
// In-Memory LRU Cache
// ============================================

interface LRUEntry {
  snapshot: GraphSnapshot;
  timestamp: number;
  accessCount: number;
}

class LRUCache {
  private cache = new Map<string, LRUEntry>();
  private maxEntries: number;
  
  constructor(maxEntries: number = LRU_CONFIG.MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }
  
  get(key: string): GraphSnapshot | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // Check if expired
    const ttl = key.includes(':calibrated:') ? TTL_CONFIG.CALIBRATED : TTL_CONFIG.RAW;
    if (Date.now() - entry.timestamp > ttl) {
      this.cache.delete(key);
      return null;
    }
    
    // Update access count and move to end (LRU)
    entry.accessCount++;
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry.snapshot;
  }
  
  set(key: string, snapshot: GraphSnapshot): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, {
      snapshot,
      timestamp: Date.now(),
      accessCount: 1,
    });
  }
  
  has(key: string): boolean {
    return this.get(key) !== null;
  }
  
  delete(key: string): boolean {
    return this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  getStats(): { size: number; maxEntries: number } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
    };
  }
}

// ============================================
// Cache Service
// ============================================

class SnapshotCacheService {
  private lruCache: LRUCache;
  private metrics = {
    hits: 0,
    misses: 0,
    lruHits: 0,
    dbHits: 0,
    saves: 0,
  };
  
  constructor() {
    this.lruCache = new LRUCache(LRU_CONFIG.MAX_ENTRIES);
  }
  
  /**
   * Generate versioned cache key
   * 
   * Format: graph:{kind}:{key}:{mode}:{calibrationVersion}
   */
  generateCacheKey(
    kind: 'ADDRESS' | 'ROUTE',
    key: string,
    mode: 'raw' | 'calibrated' = 'raw'
  ): string {
    const normalizedKey = key.toLowerCase();
    
    if (mode === 'calibrated') {
      return `graph:${kind.toLowerCase()}:${normalizedKey}:calibrated:${CALIBRATION_VERSION}`;
    }
    
    return `graph:${kind.toLowerCase()}:${normalizedKey}:raw`;
  }
  
  /**
   * Get TTL based on mode
   */
  getTTL(mode: 'raw' | 'calibrated'): number {
    return mode === 'calibrated' ? TTL_CONFIG.CALIBRATED : TTL_CONFIG.RAW;
  }
  
  /**
   * Get cached snapshot
   * 
   * Lookup order:
   * 1. In-memory LRU (fast path)
   * 2. Database (slow path)
   * 
   * @returns Snapshot or null if not found/expired
   */
  async getSnapshot(
    kind: 'ADDRESS' | 'ROUTE',
    key: string,
    mode: 'raw' | 'calibrated' = 'raw'
  ): Promise<GraphSnapshot | null> {
    const cacheKey = this.generateCacheKey(kind, key, mode);
    
    // Try LRU first (fast path)
    if (LRU_CONFIG.ENABLED) {
      const lruResult = this.lruCache.get(cacheKey);
      if (lruResult) {
        this.metrics.hits++;
        this.metrics.lruHits++;
        return lruResult;
      }
    }
    
    // Try database (slow path)
    const dbKey = `${key.toLowerCase()}:${mode}`;
    const dbResult = await dbGetCachedSnapshot(kind, dbKey);
    
    if (dbResult) {
      // Populate LRU cache
      const snapshot = this.documentToSnapshot(dbResult);
      if (LRU_CONFIG.ENABLED) {
        this.lruCache.set(cacheKey, snapshot);
      }
      
      this.metrics.hits++;
      this.metrics.dbHits++;
      return snapshot;
    }
    
    this.metrics.misses++;
    return null;
  }
  
  /**
   * Check if snapshot exists in cache
   */
  async hasSnapshot(
    kind: 'ADDRESS' | 'ROUTE',
    key: string,
    mode: 'raw' | 'calibrated' = 'raw'
  ): Promise<boolean> {
    const snapshot = await this.getSnapshot(kind, key, mode);
    return snapshot !== null;
  }
  
  /**
   * Save snapshot to cache
   * 
   * Saves to both LRU and database
   */
  async saveSnapshot(
    snapshot: GraphSnapshot,
    mode: 'raw' | 'calibrated' = 'raw'
  ): Promise<GraphSnapshot> {
    const kind = snapshot.kind;
    const key = kind === 'ADDRESS' ? snapshot.address! : snapshot.routeId!;
    const cacheKey = this.generateCacheKey(kind, key, mode);
    
    // Update TTL based on mode
    const ttl = this.getTTL(mode);
    const snapshotWithTTL = {
      ...snapshot,
      expiresAt: Date.now() + ttl,
    };
    
    // Save to database
    const dbCacheKey = `${key.toLowerCase()}:${mode}`;
    const saved = await dbSaveSnapshot(snapshotWithTTL, dbCacheKey);
    
    // Update snapshot with ID from database
    const finalSnapshot = {
      ...snapshotWithTTL,
      snapshotId: saved.snapshotId,
    };
    
    // Save to LRU cache
    if (LRU_CONFIG.ENABLED) {
      this.lruCache.set(cacheKey, finalSnapshot);
    }
    
    this.metrics.saves++;
    return finalSnapshot;
  }
  
  /**
   * Invalidate all caches for a specific key
   */
  async invalidate(
    kind: 'ADDRESS' | 'ROUTE',
    key: string
  ): Promise<void> {
    // Invalidate both raw and calibrated from LRU
    const rawKey = this.generateCacheKey(kind, key, 'raw');
    const calibratedKey = this.generateCacheKey(kind, key, 'calibrated');
    
    this.lruCache.delete(rawKey);
    this.lruCache.delete(calibratedKey);
    
    // Note: Database entries will expire via TTL
    // For immediate invalidation, we'd need to delete from DB
  }
  
  /**
   * Invalidate all calibrated caches (on version bump)
   * 
   * This is called when CALIBRATION_VERSION changes
   */
  async invalidateByVersion(version: string): Promise<number> {
    // Clear LRU cache entirely (simple approach)
    this.lruCache.clear();
    
    // Delete old versions from database
    const result = await GraphSnapshotModel.deleteMany({
      mode: 'calibrated',
      'calibrationMeta.version': { $ne: version },
    });
    
    return result.deletedCount || 0;
  }
  
  /**
   * Clear all expired entries
   */
  async clearExpired(): Promise<number> {
    const now = Date.now();
    
    const result = await GraphSnapshotModel.deleteMany({
      expiresAt: { $lt: now },
    });
    
    return result.deletedCount || 0;
  }
  
  /**
   * Get cache metrics
   */
  getMetrics(): {
    hits: number;
    misses: number;
    hitRate: number;
    lruHits: number;
    dbHits: number;
    saves: number;
    lruStats: { size: number; maxEntries: number };
  } {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRate = total > 0 ? this.metrics.hits / total : 0;
    
    return {
      ...this.metrics,
      hitRate: Number(hitRate.toFixed(4)),
      lruStats: this.lruCache.getStats(),
    };
  }
  
  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      lruHits: 0,
      dbHits: 0,
      saves: 0,
    };
  }
  
  // ============================================
  // Private Helpers
  // ============================================
  
  private documentToSnapshot(doc: any): GraphSnapshot {
    return {
      snapshotId: doc.snapshotId,
      kind: doc.kind,
      address: doc.address,
      routeId: doc.routeId,
      nodes: doc.nodes,
      edges: doc.edges,
      highlightedPath: doc.highlightedPath,
      riskSummary: doc.riskSummary,
      explain: doc.explain,
      truncated: doc.truncated,
      generatedAt: doc.generatedAt,
      expiresAt: doc.expiresAt,
      buildTimeMs: doc.buildTimeMs,
      // P2.2 fields
      corridors: doc.corridors,
      calibrationMeta: doc.calibrationMeta,
    } as GraphSnapshot;
  }
}

// ============================================
// Singleton Export
// ============================================

export const snapshotCache = new SnapshotCacheService();
