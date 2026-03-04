/**
 * Tests for Corridor Aggregator
 * 
 * Validates:
 * - Aggregation only when >= 2 edges
 * - preserveEdgeIds (highlightedPath not aggregated)
 * - Correct sum weight / weighted avg confidence
 * - Determinism and sorting
 * - Correct keying direction:fromType→toType
 */

import { describe, it, expect } from '@jest/globals';
import {
  aggregateCorridors,
  getTopCorridors,
  edgeInCorridor,
  getCorridorStats,
} from '../corridor_aggregator.js';
import { CalibratedEdge, CalibratedNode } from '../types.js';

// Helper functions
function edge(
  id: string,
  from: string,
  to: string,
  direction: 'IN' | 'OUT',
  weight: number,
  confidence: number
): CalibratedEdge {
  return {
    id,
    from,
    to,
    direction,
    weight,
    confidence,
  };
}

function node(id: string, type: string): CalibratedNode {
  return {
    id,
    type: type as any,
    confidence: 1,
    sizeWeight: 1,
    roleScore: 1,
  };
}

describe('Corridor Aggregator', () => {
  describe('aggregateCorridors', () => {
    it('aggregates edges with same direction + fromType→toType', () => {
      const edges = [
        edge('e1', 'wallet1', 'cex1', 'OUT', 10, 0.8),
        edge('e2', 'wallet2', 'cex2', 'OUT', 20, 0.6),
      ];

      const nodes = [
        node('wallet1', 'Wallet'),
        node('wallet2', 'Wallet'),
        node('cex1', 'CEX'),
        node('cex2', 'CEX'),
      ];

      const corridors = aggregateCorridors(edges, nodes, {
        preserveEdgeIds: [],
        minWeight: 0,
        enabled: true,
      });

      expect(corridors.length).toBe(1);

      const corridor = corridors[0];
      expect(corridor.key).toBe('OUT:Wallet→CEX');
      expect(corridor.edgeIds).toEqual(['e1', 'e2']);
      expect(corridor.weight).toBe(30);
      
      // Weighted avg: (10 * 0.8 + 20 * 0.6) / 30 = 20/30 = 0.6667
      expect(corridor.confidence).toBeCloseTo(0.6667, 4);
    });

    it('does NOT aggregate when only one edge matches', () => {
      const edges = [
        edge('e1', 'wallet1', 'cex1', 'OUT', 10, 0.9),
      ];

      const nodes = [
        node('wallet1', 'Wallet'),
        node('cex1', 'CEX'),
      ];

      const corridors = aggregateCorridors(edges, nodes, {
        preserveEdgeIds: [],
        minWeight: 0,
        enabled: true,
      });

      // Only 1 edge, no corridor created
      expect(corridors.length).toBe(0);
    });

    it('preserves highlightedPath edges (never aggregated)', () => {
      const edges = [
        edge('e1', 'wallet1', 'cex1', 'OUT', 10, 0.9),
        edge('e2', 'wallet2', 'cex2', 'OUT', 20, 0.7),
      ];

      const nodes = [
        node('wallet1', 'Wallet'),
        node('wallet2', 'Wallet'),
        node('cex1', 'CEX'),
        node('cex2', 'CEX'),
      ];

      // Preserve e1 (highlightedPath)
      const corridors = aggregateCorridors(edges, nodes, {
        preserveEdgeIds: ['e1'],
        minWeight: 0,
        enabled: true,
      });

      // Only e2 remains, not enough for corridor
      expect(corridors.length).toBe(0);
    });

    it('sorts corridors by weight DESC (deterministic)', () => {
      const edges = [
        edge('e1', 'w1', 'cex1', 'OUT', 10, 0.8),
        edge('e2', 'w2', 'cex2', 'OUT', 20, 0.6),
        edge('e3', 'w3', 'dex1', 'OUT', 50, 0.9),
        edge('e4', 'w4', 'dex2', 'OUT', 10, 0.9),
      ];

      const nodes = [
        node('w1', 'Wallet'),
        node('w2', 'Wallet'),
        node('w3', 'Wallet'),
        node('w4', 'Wallet'),
        node('cex1', 'CEX'),
        node('cex2', 'CEX'),
        node('dex1', 'DEX'),
        node('dex2', 'DEX'),
      ];

      const corridors = aggregateCorridors(edges, nodes, {
        preserveEdgeIds: [],
        minWeight: 0,
        enabled: true,
      });

      expect(corridors.length).toBe(2);
      
      // DEX corridor should be first (50+10=60 > 30)
      expect(corridors[0].key).toBe('OUT:Wallet→DEX');
      expect(corridors[0].weight).toBe(60);
      
      // CEX corridor second
      expect(corridors[1].key).toBe('OUT:Wallet→CEX');
      expect(corridors[1].weight).toBe(30);
    });

    it('respects minWeight filter', () => {
      const edges = [
        edge('e1', 'w1', 'cex1', 'OUT', 0.001, 0.8), // dust
        edge('e2', 'w2', 'cex2', 'OUT', 20, 0.6),
      ];

      const nodes = [
        node('w1', 'Wallet'),
        node('w2', 'Wallet'),
        node('cex1', 'CEX'),
        node('cex2', 'CEX'),
      ];

      const corridors = aggregateCorridors(edges, nodes, {
        preserveEdgeIds: [],
        minWeight: 0.01, // Filter dust
        enabled: true,
      });

      // Only e2 passes, not enough for corridor
      expect(corridors.length).toBe(0);
    });

    it('handles different directions separately', () => {
      const edges = [
        edge('e1', 'w1', 'cex1', 'OUT', 10, 0.8),
        edge('e2', 'w2', 'cex2', 'OUT', 20, 0.6),
        edge('e3', 'cex3', 'w3', 'IN', 15, 0.7),
        edge('e4', 'cex4', 'w4', 'IN', 25, 0.9),
      ];

      const nodes = [
        node('w1', 'Wallet'),
        node('w2', 'Wallet'),
        node('w3', 'Wallet'),
        node('w4', 'Wallet'),
        node('cex1', 'CEX'),
        node('cex2', 'CEX'),
        node('cex3', 'CEX'),
        node('cex4', 'CEX'),
      ];

      const corridors = aggregateCorridors(edges, nodes, {
        preserveEdgeIds: [],
        minWeight: 0,
        enabled: true,
      });

      expect(corridors.length).toBe(2);
      
      // Should have both OUT and IN corridors
      const outCorridor = corridors.find(c => c.direction === 'OUT');
      const inCorridor = corridors.find(c => c.direction === 'IN');
      
      expect(outCorridor).toBeDefined();
      expect(inCorridor).toBeDefined();
      
      expect(outCorridor!.key).toBe('OUT:Wallet→CEX');
      expect(inCorridor!.key).toBe('IN:CEX→Wallet');
    });

    it('returns empty when disabled', () => {
      const edges = [
        edge('e1', 'w1', 'cex1', 'OUT', 10, 0.8),
        edge('e2', 'w2', 'cex2', 'OUT', 20, 0.6),
      ];

      const corridors = aggregateCorridors(edges, [], {
        preserveEdgeIds: [],
        minWeight: 0,
        enabled: false, // Disabled
      });

      expect(corridors.length).toBe(0);
    });
  });

  describe('getTopCorridors', () => {
    it('returns top N corridors by weight', () => {
      const edges = [
        edge('e1', 'w1', 'cex1', 'OUT', 10, 0.8),
        edge('e2', 'w2', 'cex2', 'OUT', 20, 0.6),
        edge('e3', 'w3', 'dex1', 'OUT', 50, 0.9),
        edge('e4', 'w4', 'dex2', 'OUT', 10, 0.9),
      ];

      const nodes = [
        node('w1', 'Wallet'),
        node('w2', 'Wallet'),
        node('w3', 'Wallet'),
        node('w4', 'Wallet'),
        node('cex1', 'CEX'),
        node('cex2', 'CEX'),
        node('dex1', 'DEX'),
        node('dex2', 'DEX'),
      ];

      const corridors = aggregateCorridors(edges, nodes, {
        preserveEdgeIds: [],
        minWeight: 0,
        enabled: true,
      });

      const top1 = getTopCorridors(corridors, 1);
      
      expect(top1.length).toBe(1);
      expect(top1[0].key).toBe('OUT:Wallet→DEX');
    });
  });

  describe('edgeInCorridor', () => {
    it('correctly detects edge membership', () => {
      const edges = [
        edge('e1', 'w1', 'cex1', 'OUT', 10, 0.8),
        edge('e2', 'w2', 'cex2', 'OUT', 20, 0.6),
      ];

      const nodes = [
        node('w1', 'Wallet'),
        node('w2', 'Wallet'),
        node('cex1', 'CEX'),
        node('cex2', 'CEX'),
      ];

      const corridors = aggregateCorridors(edges, nodes, {
        preserveEdgeIds: [],
        minWeight: 0,
        enabled: true,
      });

      const corridor = corridors[0];
      
      expect(edgeInCorridor('e1', [corridor])).toBeDefined();
      expect(edgeInCorridor('e2', [corridor])).toBeDefined();
      expect(edgeInCorridor('eX', [corridor])).toBeUndefined();
    });
  });

  describe('getCorridorStats', () => {
    it('calculates correct statistics', () => {
      const edges = [
        edge('e1', 'w1', 'cex1', 'OUT', 10, 0.8),
        edge('e2', 'w2', 'cex2', 'OUT', 20, 0.6),
        edge('e3', 'w3', 'dex1', 'OUT', 50, 0.9),
        edge('e4', 'w4', 'dex2', 'OUT', 10, 0.9),
      ];

      const nodes = [
        node('w1', 'Wallet'),
        node('w2', 'Wallet'),
        node('w3', 'Wallet'),
        node('w4', 'Wallet'),
        node('cex1', 'CEX'),
        node('cex2', 'CEX'),
        node('dex1', 'DEX'),
        node('dex2', 'DEX'),
      ];

      const corridors = aggregateCorridors(edges, nodes, {
        preserveEdgeIds: [],
        minWeight: 0,
        enabled: true,
      });

      const stats = getCorridorStats(corridors);
      
      expect(stats.totalCorridors).toBe(2);
      expect(stats.totalEdgesAggregated).toBe(4);
      expect(stats.topCorridorWeight).toBe(60); // DEX corridor
      expect(stats.avgCorridorWeight).toBe(45); // (60+30)/2
    });
  });
});
