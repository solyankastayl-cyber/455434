/**
 * P2.3.1: Snapshot Cache Service Tests
 * 
 * Tests for versioned caching with TTL strategy
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the database functions
vi.mock('../../storage/graph_snapshot.model.js', () => ({
  getCachedSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
  GraphSnapshotModel: {
    deleteMany: vi.fn(),
  },
}));

import { snapshotCache, CALIBRATION_VERSION, TTL_CONFIG } from '../snapshot_cache.service.js';

describe('SnapshotCacheService', () => {
  beforeEach(() => {
    snapshotCache.resetMetrics();
    vi.clearAllMocks();
  });
  
  describe('generateCacheKey', () => {
    it('should generate correct key for raw mode', () => {
      const key = snapshotCache.generateCacheKey('ADDRESS', '0xABC123', 'raw');
      expect(key).toBe('graph:address:0xabc123:raw');
    });
    
    it('should generate correct key for calibrated mode', () => {
      const key = snapshotCache.generateCacheKey('ADDRESS', '0xABC123', 'calibrated');
      expect(key).toBe(`graph:address:0xabc123:calibrated:${CALIBRATION_VERSION}`);
    });
    
    it('should normalize address to lowercase', () => {
      const key = snapshotCache.generateCacheKey('ADDRESS', '0xABCDEF', 'raw');
      expect(key).toContain('0xabcdef');
    });
    
    it('should handle ROUTE kind', () => {
      const key = snapshotCache.generateCacheKey('ROUTE', 'route-123', 'calibrated');
      expect(key).toContain('route:route-123');
    });
  });
  
  describe('getTTL', () => {
    it('should return shorter TTL for raw mode', () => {
      const rawTTL = snapshotCache.getTTL('raw');
      expect(rawTTL).toBe(TTL_CONFIG.RAW);
      expect(rawTTL).toBeLessThan(snapshotCache.getTTL('calibrated'));
    });
    
    it('should return longer TTL for calibrated mode', () => {
      const calibratedTTL = snapshotCache.getTTL('calibrated');
      expect(calibratedTTL).toBe(TTL_CONFIG.CALIBRATED);
    });
  });
  
  describe('getMetrics', () => {
    it('should return initial metrics with zero values', () => {
      const metrics = snapshotCache.getMetrics();
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(0);
      expect(metrics.hitRate).toBe(0);
    });
    
    it('should include LRU stats', () => {
      const metrics = snapshotCache.getMetrics();
      expect(metrics.lruStats).toBeDefined();
      expect(metrics.lruStats.maxEntries).toBeGreaterThan(0);
    });
  });
  
  describe('CALIBRATION_VERSION', () => {
    it('should be P2.2-Phase2', () => {
      expect(CALIBRATION_VERSION).toBe('P2.2-Phase2');
    });
  });
  
  describe('TTL_CONFIG', () => {
    it('should have raw TTL of 5 minutes', () => {
      expect(TTL_CONFIG.RAW).toBe(5 * 60 * 1000);
    });
    
    it('should have calibrated TTL of 30 minutes', () => {
      expect(TTL_CONFIG.CALIBRATED).toBe(30 * 60 * 1000);
    });
  });
});

describe('Cache Key Versioning', () => {
  it('should include calibration version in calibrated keys', () => {
    const key = snapshotCache.generateCacheKey('ADDRESS', '0x123', 'calibrated');
    expect(key).toContain(CALIBRATION_VERSION);
  });
  
  it('should NOT include calibration version in raw keys', () => {
    const key = snapshotCache.generateCacheKey('ADDRESS', '0x123', 'raw');
    expect(key).not.toContain(CALIBRATION_VERSION);
  });
  
  it('should generate different keys for same address with different modes', () => {
    const rawKey = snapshotCache.generateCacheKey('ADDRESS', '0x123', 'raw');
    const calibratedKey = snapshotCache.generateCacheKey('ADDRESS', '0x123', 'calibrated');
    expect(rawKey).not.toBe(calibratedKey);
  });
});
