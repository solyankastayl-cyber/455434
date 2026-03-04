/**
 * Tests for Confidence Normalizer
 */

import { describe, it, expect } from '@jest/globals';
import {
  normalizeEdgeWeights,
  normalizeNodeWeights,
  verifyMonotonicity,
} from '../confidence_normalizer.js';
import { CalibratedEdge, CalibratedNode, CalibrationConfig } from '../types.js';

const mockConfig: CalibrationConfig = {
  normalizationStrategy: 'quantile',
  weightRange: { min: 0, max: 1 },
  nodeTypeMultipliers: {
    CEX: 1.5,
    DEX: 1.2,
    Bridge: 1.1,
    Wallet: 1.0,
  },
};

const createMockEdge = (weight: number): CalibratedEdge => ({
  from: 'a',
  to: 'b',
  direction: 'OUT',
  weight,
  confidence: 1,
  id: `edge-${weight}`,
});

const createMockNode = (sizeWeight: number): CalibratedNode => ({
  id: `node-${sizeWeight}`,
  type: 'Wallet',
  sizeWeight,
  confidence: 1,
  roleScore: 1,
});

describe('Confidence Normalizer', () => {
  describe('normalizeEdgeWeights', () => {
    it('preserves ordering (monotonic)', () => {
      const edges = [
        createMockEdge(10),
        createMockEdge(100),
        createMockEdge(1000),
      ];
      
      const normalized = normalizeEdgeWeights(edges, mockConfig);
      
      expect(normalized[0].weight).toBeLessThan(normalized[1].weight);
      expect(normalized[1].weight).toBeLessThan(normalized[2].weight);
    });
    
    it('maps min to 0 and max to 1', () => {
      const edges = [
        createMockEdge(1),
        createMockEdge(100),
      ];
      
      const normalized = normalizeEdgeWeights(edges, mockConfig);
      
      expect(normalized[0].weight).toBe(0);
      expect(normalized[1].weight).toBe(1);
    });
    
    it('handles single edge', () => {
      const edges = [createMockEdge(42)];
      
      const normalized = normalizeEdgeWeights(edges, mockConfig);
      
      expect(normalized[0].weight).toBe(1);
    });
    
    it('handles empty array', () => {
      const normalized = normalizeEdgeWeights([], mockConfig);
      
      expect(normalized).toEqual([]);
    });
    
    it('is deterministic', () => {
      const edges = [
        createMockEdge(10),
        createMockEdge(20),
        createMockEdge(30),
      ];
      
      const r1 = normalizeEdgeWeights(edges, mockConfig);
      const r2 = normalizeEdgeWeights(edges, mockConfig);
      
      expect(r1).toEqual(r2);
    });
    
    it('respects custom weight range', () => {
      const customConfig = {
        ...mockConfig,
        weightRange: { min: 0.2, max: 0.8 },
      };
      
      const edges = [
        createMockEdge(1),
        createMockEdge(50),
        createMockEdge(100),
      ];
      
      const normalized = normalizeEdgeWeights(edges, customConfig);
      
      expect(normalized[0].weight).toBe(0.2);
      expect(normalized[2].weight).toBe(0.8);
      expect(normalized[1].weight).toBeGreaterThan(0.2);
      expect(normalized[1].weight).toBeLessThan(0.8);
    });
  });
  
  describe('normalizeNodeWeights', () => {
    it('preserves ordering for nodes', () => {
      const nodes = [
        createMockNode(1),
        createMockNode(5),
        createMockNode(10),
      ];
      
      const normalized = normalizeNodeWeights(nodes, mockConfig);
      
      expect(normalized[0].sizeWeight).toBeLessThan(normalized[1].sizeWeight);
      expect(normalized[1].sizeWeight).toBeLessThan(normalized[2].sizeWeight);
    });
    
    it('maps min to 0 and max to 1', () => {
      const nodes = [
        createMockNode(0.5),
        createMockNode(10),
      ];
      
      const normalized = normalizeNodeWeights(nodes, mockConfig);
      
      expect(normalized[0].sizeWeight).toBe(0);
      expect(normalized[1].sizeWeight).toBe(1);
    });
    
    it('handles single node', () => {
      const nodes = [createMockNode(5)];
      
      const normalized = normalizeNodeWeights(nodes, mockConfig);
      
      expect(normalized[0].sizeWeight).toBe(1);
    });
  });
  
  describe('verifyMonotonicity', () => {
    it('returns true for monotonic transformation', () => {
      const original = [1, 5, 10, 50, 100];
      const normalized = [0, 0.25, 0.5, 0.75, 1.0];
      
      expect(verifyMonotonicity(original, normalized)).toBe(true);
    });
    
    it('returns false for non-monotonic transformation', () => {
      const original = [1, 5, 10];
      const broken = [0, 1, 0.5]; // Order broken!
      
      expect(verifyMonotonicity(original, broken)).toBe(false);
    });
    
    it('handles equal values', () => {
      const original = [1, 1, 2];
      const normalized = [0, 0, 1];
      
      expect(verifyMonotonicity(original, normalized)).toBe(true);
    });
    
    it('returns false for different lengths', () => {
      const original = [1, 2, 3];
      const normalized = [0, 1];
      
      expect(verifyMonotonicity(original, normalized)).toBe(false);
    });
  });
  
  describe('Integration', () => {
    it('handles realistic edge distribution', () => {
      const edges = [
        createMockEdge(1), // Dust
        createMockEdge(10),
        createMockEdge(50),
        createMockEdge(100),
        createMockEdge(1000), // Major flow
        createMockEdge(10000), // Whale
      ];
      
      const normalized = normalizeEdgeWeights(edges, mockConfig);
      
      // Top 5% should be at max
      expect(normalized[5].weight).toBe(1.0);
      
      // Dust should be at min
      expect(normalized[0].weight).toBe(0);
      
      // Middle values should be spread
      const middleWeights = normalized.slice(1, 5).map(e => e.weight);
      expect(Math.max(...middleWeights) - Math.min(...middleWeights)).toBeGreaterThan(0.3);
    });
  });
});
