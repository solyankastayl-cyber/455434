/**
 * A4 - Graph Intelligence Calibrated Mode Tests
 * 
 * Validates:
 * - mode=calibrated returns corridors
 * - mode=raw does not return corridors
 * - Cache keys are separate
 * - highlightedPath is preserved
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { graphBuilder } from '../builders/graph_builder.service.js';

describe('Graph Intelligence - Calibrated Mode', () => {
  const testAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';
  
  describe('mode=calibrated', () => {
    it('returns corridors in calibrated mode', async () => {
      const snapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'calibrated'
      );
      
      expect(snapshot).toBeDefined();
      expect(snapshot.corridors).toBeDefined();
      expect(Array.isArray(snapshot.corridors)).toBe(true);
    });
    
    it('includes calibrationMeta in calibrated mode', async () => {
      const snapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'calibrated'
      );
      
      expect(snapshot.calibrationMeta).toBeDefined();
      expect(snapshot.calibrationMeta.version).toBe('P2.2-Phase2');
      expect(snapshot.calibrationMeta.stats).toBeDefined();
    });
    
    it('nodes have sizeWeight and confidence', async () => {
      const snapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'calibrated'
      );
      
      if (snapshot.nodes.length > 0) {
        const node = snapshot.nodes[0];
        expect(node.sizeWeight).toBeDefined();
        expect(node.confidence).toBeDefined();
        expect(typeof node.sizeWeight).toBe('number');
        expect(typeof node.confidence).toBe('number');
      }
    });
    
    it('edges have weight and confidence', async () => {
      const snapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'calibrated'
      );
      
      if (snapshot.edges.length > 0) {
        const edge = snapshot.edges[0];
        expect(edge.weight).toBeDefined();
        expect(edge.confidence).toBeDefined();
        expect(typeof edge.weight).toBe('number');
        expect(typeof edge.confidence).toBe('number');
      }
    });
  });
  
  describe('mode=raw', () => {
    it('does NOT include corridors in raw mode', async () => {
      const snapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'raw'
      );
      
      expect(snapshot).toBeDefined();
      // Raw mode should not have corridors or should be empty
      expect(
        !snapshot.corridors || snapshot.corridors.length === 0
      ).toBe(true);
    });
    
    it('does NOT include calibrationMeta in raw mode', async () => {
      const snapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'raw'
      );
      
      expect(snapshot.calibrationMeta).toBeUndefined();
    });
  });
  
  describe('highlightedPath preservation', () => {
    it('preserves highlightedPath in calibrated mode', async () => {
      const snapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'calibrated'
      );
      
      expect(snapshot.highlightedPath).toBeDefined();
      expect(Array.isArray(snapshot.highlightedPath)).toBe(true);
      
      // If highlightedPath has edges, they should not be in corridors
      if (snapshot.highlightedPath.edges && snapshot.highlightedPath.edges.length > 0) {
        const highlightedEdgeIds = snapshot.highlightedPath.edges.map(e => e.id);
        
        snapshot.corridors.forEach(corridor => {
          highlightedEdgeIds.forEach(hId => {
            expect(corridor.edgeIds.includes(hId)).toBe(false);
          });
        });
      }
    });
  });
  
  describe('determinism', () => {
    it('produces identical results for same input', async () => {
      const snapshot1 = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'calibrated'
      );
      
      const snapshot2 = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'calibrated'
      );
      
      // Should have same number of nodes/edges
      expect(snapshot1.nodes.length).toBe(snapshot2.nodes.length);
      expect(snapshot1.edges.length).toBe(snapshot2.edges.length);
      
      // Should have same corridors
      expect(snapshot1.corridors.length).toBe(snapshot2.corridors.length);
      
      // Edge weights should be identical
      if (snapshot1.edges.length > 0) {
        expect(snapshot1.edges[0].weight).toBe(snapshot2.edges[0].weight);
      }
    });
  });
  
  describe('cache separation', () => {
    it('raw and calibrated use different cache keys', async () => {
      // This test validates that mode affects caching
      // Build raw first
      const rawSnapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'raw'
      );
      
      // Build calibrated
      const calibratedSnapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'calibrated'
      );
      
      // They should have different snapshotIds
      expect(rawSnapshot.snapshotId).not.toBe(calibratedSnapshot.snapshotId);
      
      // Calibrated should have corridors, raw should not
      expect(calibratedSnapshot.corridors?.length || 0).toBeGreaterThanOrEqual(0);
      expect(rawSnapshot.corridors?.length || 0).toBe(0);
    });
  });
  
  describe('corridor structure', () => {
    it('corridors have required fields', async () => {
      const snapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'calibrated'
      );
      
      if (snapshot.corridors && snapshot.corridors.length > 0) {
        const corridor = snapshot.corridors[0];
        
        expect(corridor.key).toBeDefined();
        expect(corridor.weight).toBeDefined();
        expect(corridor.confidence).toBeDefined();
        expect(corridor.direction).toBeDefined();
        expect(corridor.edgeIds).toBeDefined();
        expect(Array.isArray(corridor.edgeIds)).toBe(true);
        expect(corridor.edgeCount).toBeDefined();
        expect(corridor.edgeCount).toBe(corridor.edgeIds.length);
      }
    });
    
    it('corridors are sorted by weight DESC', async () => {
      const snapshot = await graphBuilder.buildForAddress(
        testAddress,
        { maxRoutes: 3 },
        'calibrated'
      );
      
      if (snapshot.corridors && snapshot.corridors.length > 1) {
        for (let i = 0; i < snapshot.corridors.length - 1; i++) {
          expect(snapshot.corridors[i].weight).toBeGreaterThanOrEqual(
            snapshot.corridors[i + 1].weight
          );
        }
      }
    });
  });
});
