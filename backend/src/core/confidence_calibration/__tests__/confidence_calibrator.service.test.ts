/**
 * Integration tests for Confidence Calibrator Service
 */

import { describe, it, expect } from '@jest/globals';
import {
  calibrateGraph,
  validateRawGraph,
  getCalibrationSummary,
} from '../confidence_calibrator.service.js';
import { RawGraphSnapshot, CalibrationConfig } from '../types.js';

const mockConfig: CalibrationConfig = {
  normalizationStrategy: 'quantile',
  weightRange: { min: 0.1, max: 1.0 },
  nodeTypeMultipliers: {
    CEX: 1.5,
    DEX: 1.2,
    Bridge: 1.1,
    Wallet: 1.0,
  },
  minConfidenceThreshold: 0.01,
};

const createMockRawGraph = (): RawGraphSnapshot => ({
  nodes: [
    {
      id: 'wallet1',
      type: 'Wallet',
      label: 'Wallet 1',
      totalIncomingVolumeUsd: 1000,
      totalOutgoingVolumeUsd: 500,
      connectionCount: 2,
      reliability: 0.9,
    },
    {
      id: 'binance',
      type: 'CEX',
      label: 'Binance Hot Wallet',
      totalIncomingVolumeUsd: 100000,
      totalOutgoingVolumeUsd: 50000,
      connectionCount: 50,
      reliability: 1.0,
    },
  ],
  edges: [
    {
      from: 'wallet1',
      to: 'binance',
      direction: 'OUT',
      txCount: 5,
      volumeUsd: 10000,
      routeConfidence: 0.9,
      marketModifier: 1.0,
      dataQuality: 0.95,
      actorReliability: 0.9,
    },
  ],
  metadata: {
    snapshotId: 'test-snapshot',
  },
});

describe('Confidence Calibrator Service', () => {
  describe('calibrateGraph', () => {
    it('produces a fully calibrated graph', () => {
      const rawGraph = createMockRawGraph();
      
      const result = calibrateGraph(rawGraph, mockConfig);
      
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.calibrationMeta).toBeDefined();
      expect(result.calibrationMeta.version).toBe('P2.2-Phase1');
    });
    
    it('calibrated edges have weights in normalized range', () => {
      const rawGraph = createMockRawGraph();
      
      const result = calibrateGraph(rawGraph, mockConfig);
      
      result.edges.forEach(edge => {
        expect(edge.weight).toBeGreaterThanOrEqual(mockConfig.weightRange.min);
        expect(edge.weight).toBeLessThanOrEqual(mockConfig.weightRange.max);
      });
    });
    
    it('calibrated nodes have size weights', () => {
      const rawGraph = createMockRawGraph();
      
      const result = calibrateGraph(rawGraph, mockConfig);
      
      result.nodes.forEach(node => {
        expect(node.sizeWeight).toBeGreaterThanOrEqual(0);
        expect(node.confidence).toBeGreaterThanOrEqual(0);
        expect(node.confidence).toBeLessThanOrEqual(1);
      });
    });
    
    it('CEX nodes have higher weights than wallets', () => {
      const rawGraph = createMockRawGraph();
      
      const result = calibrateGraph(rawGraph, mockConfig);
      
      const wallet = result.nodes.find(n => n.id === 'wallet1')!;
      const cex = result.nodes.find(n => n.id === 'binance')!;
      
      // CEX should have higher weight due to 1.5x multiplier
      expect(cex.sizeWeight).toBeGreaterThan(wallet.sizeWeight);
    });
    
    it('includes calibration metadata', () => {
      const rawGraph = createMockRawGraph();
      
      const result = calibrateGraph(rawGraph, mockConfig);
      
      expect(result.calibrationMeta.timestamp).toBeGreaterThan(0);
      expect(result.calibrationMeta.parameters).toBeDefined();
      expect(result.calibrationMeta.stats).toBeDefined();
      expect(result.calibrationMeta.stats.totalEdges).toBe(1);
      expect(result.calibrationMeta.stats.totalNodes).toBe(2);
    });
    
    it('is deterministic', () => {
      const rawGraph = createMockRawGraph();
      
      const result1 = calibrateGraph(rawGraph, mockConfig);
      const result2 = calibrateGraph(rawGraph, mockConfig);
      
      // Edge weights should be identical
      expect(result1.edges[0].weight).toBe(result2.edges[0].weight);
      
      // Node weights should be identical
      expect(result1.nodes[0].sizeWeight).toBe(result2.nodes[0].sizeWeight);
    });
    
    it('handles empty edges gracefully', () => {
      const rawGraph: RawGraphSnapshot = {
        nodes: [
          {
            id: 'isolated',
            type: 'Wallet',
            totalIncomingVolumeUsd: 0,
            totalOutgoingVolumeUsd: 0,
            connectionCount: 0,
            reliability: 1,
          },
        ],
        edges: [],
        metadata: {},
      };
      
      const result = calibrateGraph(rawGraph, mockConfig);
      
      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
      expect(result.nodes[0].sizeWeight).toBe(0);
    });
  });
  
  describe('validateRawGraph', () => {
    it('accepts valid raw graph', () => {
      const rawGraph = createMockRawGraph();
      
      expect(() => validateRawGraph(rawGraph)).not.toThrow();
      expect(validateRawGraph(rawGraph)).toBe(true);
    });
    
    it('rejects null/undefined graph', () => {
      expect(() => validateRawGraph(null as any)).toThrow('null or undefined');
    });
    
    it('rejects graph without nodes array', () => {
      const invalid = { edges: [] } as any;
      
      expect(() => validateRawGraph(invalid)).toThrow('nodes must be an array');
    });
    
    it('rejects graph with duplicate node IDs', () => {
      const invalid: RawGraphSnapshot = {
        nodes: [
          { id: 'dup', type: 'Wallet', totalIncomingVolumeUsd: 0, totalOutgoingVolumeUsd: 0, connectionCount: 0, reliability: 1 },
          { id: 'dup', type: 'Wallet', totalIncomingVolumeUsd: 0, totalOutgoingVolumeUsd: 0, connectionCount: 0, reliability: 1 },
        ],
        edges: [],
        metadata: {},
      };
      
      expect(() => validateRawGraph(invalid)).toThrow('duplicate node IDs');
    });
  });
  
  describe('getCalibrationSummary', () => {
    it('produces readable summary', () => {
      const rawGraph = createMockRawGraph();
      const result = calibrateGraph(rawGraph, mockConfig);
      
      const summary = getCalibrationSummary(result);
      
      expect(summary).toContain('Calibration Summary');
      expect(summary).toContain('Version: P2.2-Phase1');
      expect(summary).toContain('Nodes: 2');
      expect(summary).toContain('Edges: 1');
      expect(summary).toContain('Normalization: quantile');
    });
  });
  
  describe('Integration Scenarios', () => {
    it('realistic multi-node graph', () => {
      const rawGraph: RawGraphSnapshot = {
        nodes: [
          { id: 'w1', type: 'Wallet', label: 'w1', totalIncomingVolumeUsd: 1000, totalOutgoingVolumeUsd: 500, connectionCount: 2, reliability: 0.8 },
          { id: 'w2', type: 'Wallet', label: 'w2', totalIncomingVolumeUsd: 2000, totalOutgoingVolumeUsd: 1000, connectionCount: 3, reliability: 0.9 },
          { id: 'cex', type: 'CEX', label: 'CEX', totalIncomingVolumeUsd: 100000, totalOutgoingVolumeUsd: 50000, connectionCount: 100, reliability: 1.0 },
          { id: 'dex', type: 'DEX', label: 'DEX', totalIncomingVolumeUsd: 50000, totalOutgoingVolumeUsd: 25000, connectionCount: 50, reliability: 0.95 },
        ],
        edges: [
          { from: 'w1', to: 'cex', direction: 'OUT', txCount: 5, volumeUsd: 10000, routeConfidence: 0.9, marketModifier: 1.0, dataQuality: 0.95, actorReliability: 0.8 },
          { from: 'w2', to: 'dex', direction: 'OUT', txCount: 3, volumeUsd: 5000, routeConfidence: 0.85, marketModifier: 1.0, dataQuality: 0.9, actorReliability: 0.9 },
          { from: 'cex', to: 'w2', direction: 'OUT', txCount: 10, volumeUsd: 50000, routeConfidence: 0.95, marketModifier: 1.2, dataQuality: 0.98, actorReliability: 1.0 },
        ],
        metadata: { snapshotId: 'multi-node' },
      };
      
      const result = calibrateGraph(rawGraph, mockConfig);
      
      // All nodes present
      expect(result.nodes).toHaveLength(4);
      expect(result.edges).toHaveLength(3);
      
      // CEX should dominate
      const cex = result.nodes.find(n => n.id === 'cex')!;
      const wallets = result.nodes.filter(n => n.type === 'Wallet');
      
      wallets.forEach(w => {
        expect(cex.sizeWeight).toBeGreaterThanOrEqual(w.sizeWeight);
      });
      
      // All confidences valid
      result.nodes.forEach(n => {
        expect(n.confidence).toBeGreaterThanOrEqual(0);
        expect(n.confidence).toBeLessThanOrEqual(1);
      });
    });
  });
});
