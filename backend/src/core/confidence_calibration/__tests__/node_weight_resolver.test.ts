/**
 * Tests for Node Weight Resolver
 */

import { describe, it, expect } from '@jest/globals';
import {
  resolveNodeWeights,
  getNodeWeightBreakdown,
} from '../node_weight_resolver.js';
import { RawNodeSignal, CalibratedEdge, CalibrationConfig } from '../types.js';

const mockConfig: CalibrationConfig = {
  normalizationStrategy: 'quantile',
  weightRange: { min: 0.1, max: 1.0 },
  nodeTypeMultipliers: {
    CEX: 1.5,
    DEX: 1.2,
    Bridge: 1.1,
    Wallet: 1.0,
  },
};

const createMockNode = (overrides: Partial<RawNodeSignal> = {}): RawNodeSignal => ({
  id: 'node1',
  type: 'Wallet',
  totalIncomingVolumeUsd: 0,
  totalOutgoingVolumeUsd: 0,
  connectionCount: 0,
  reliability: 1.0,
  ...overrides,
});

const createMockEdge = (overrides: Partial<CalibratedEdge> = {}): CalibratedEdge => ({
  from: 'from',
  to: 'to',
  direction: 'OUT',
  weight: 1.0,
  confidence: 0.8,
  id: 'edge1',
  ...overrides,
});

describe('Node Weight Resolver', () => {
  it('calculates node weight from incoming + outgoing edges', () => {
    const nodes = [
      createMockNode({ id: 'w1', type: 'Wallet' }),
      createMockNode({ id: 'cex', type: 'CEX' }),
    ];
    
    const edges = [
      createMockEdge({ from: 'w1', to: 'cex', weight: 10 }),
    ];
    
    const result = resolveNodeWeights(nodes, edges, mockConfig);
    
    const w1 = result.find(n => n.id === 'w1')!;
    const cex = result.find(n => n.id === 'cex')!;
    
    // w1 has outgoing weight of 10
    expect(w1.sizeWeight).toBeGreaterThan(0);
    
    // cex has incoming weight of 10 × 1.5 (CEX multiplier)
    expect(cex.sizeWeight).toBeGreaterThan(w1.sizeWeight);
  });
  
  it('applies type multipliers correctly', () => {
    const nodes = [
      createMockNode({ id: 'wallet', type: 'Wallet' }),
      createMockNode({ id: 'cex', type: 'CEX' }),
      createMockNode({ id: 'dex', type: 'DEX' }),
    ];
    
    const edges = [
      // Same weight to all
      createMockEdge({ from: 'x', to: 'wallet', weight: 10 }),
      createMockEdge({ from: 'x', to: 'cex', weight: 10 }),
      createMockEdge({ from: 'x', to: 'dex', weight: 10 }),
    ];
    
    const result = resolveNodeWeights(nodes, edges, mockConfig);
    
    const wallet = result.find(n => n.id === 'wallet')!;
    const cex = result.find(n => n.id === 'cex')!;
    const dex = result.find(n => n.id === 'dex')!;
    
    // CEX should have highest weight (1.5x)
    expect(cex.sizeWeight).toBeGreaterThan(dex.sizeWeight);
    // DEX should be higher than wallet (1.2x vs 1.0x)
    expect(dex.sizeWeight).toBeGreaterThan(wallet.sizeWeight);
  });
  
  it('calculates weighted average confidence', () => {
    const nodes = [
      createMockNode({ id: 'n1', type: 'Wallet' }),
    ];
    
    const edges = [
      createMockEdge({ from: 'n1', to: 'x', weight: 10, confidence: 1.0 }),
      createMockEdge({ from: 'y', to: 'n1', weight: 30, confidence: 0.5 }),
    ];
    
    const result = resolveNodeWeights(nodes, edges, mockConfig);
    const n1 = result[0];
    
    // (10 * 1.0 + 30 * 0.5) / (10 + 30) = 25 / 40 = 0.625
    expect(n1.confidence).toBeCloseTo(0.625, 3);
  });
  
  it('handles isolated nodes (no edges)', () => {
    const nodes = [
      createMockNode({ id: 'solo', type: 'Wallet' }),
    ];
    
    const result = resolveNodeWeights(nodes, [], mockConfig);
    
    expect(result[0].sizeWeight).toBe(0);
    expect(result[0].confidence).toBe(0);
  });
  
  it('uses log1p for stable size weight', () => {
    const nodes = [
      createMockNode({ id: 'small', type: 'Wallet' }),
      createMockNode({ id: 'whale', type: 'Wallet' }),
    ];
    
    const edges = [
      createMockEdge({ from: 'x', to: 'small', weight: 10 }),
      createMockEdge({ from: 'x', to: 'whale', weight: 10000 }),
    ];
    
    const result = resolveNodeWeights(nodes, edges, mockConfig);
    
    const small = result.find(n => n.id === 'small')!;
    const whale = result.find(n => n.id === 'whale')!;
    
    // Whale should be bigger but not 1000x (log scale)
    const ratio = whale.sizeWeight / small.sizeWeight;
    expect(ratio).toBeLessThan(100);
    expect(ratio).toBeGreaterThan(1);
  });
  
  it('getNodeWeightBreakdown produces readable output', () => {
    const nodes = [
      createMockNode({ id: 'test', type: 'CEX' }),
    ];
    
    const edges = [
      createMockEdge({ from: 'test', to: 'x', weight: 5 }),
      createMockEdge({ from: 'y', to: 'test', weight: 10 }),
    ];
    
    const breakdown = getNodeWeightBreakdown('test', nodes, edges, mockConfig);
    
    expect(breakdown).toContain('Node ID: test');
    expect(breakdown).toContain('Type: CEX');
    expect(breakdown).toContain('Type Multiplier');
  });
});
