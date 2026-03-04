/**
 * Tests for Edge Weight Resolver
 * 
 * Critical tests that MUST pass before P2.2 is complete
 */

import { describe, it, expect } from '@jest/globals';
import {
  resolveEdgeWeight,
  resolveEdgeWeightsBatch,
  getWeightBreakdown,
  shouldFilterEdge,
} from '../edge_weight_resolver.js';
import { RawEdgeSignal } from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

const createMockSignal = (overrides: Partial<RawEdgeSignal> = {}): RawEdgeSignal => ({
  from: '0xfrom',
  to: '0xto',
  direction: 'OUT',
  txCount: 10,
  volumeUsd: 1000,
  routeConfidence: 0.8,
  marketModifier: 1.0,
  dataQuality: 0.9,
  actorReliability: 0.85,
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════════
// CORE FORMULA TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Weight Resolver - Core Formula', () => {
  it('produces weight > 0 for valid signal', () => {
    const signal = createMockSignal();
    const result = resolveEdgeWeight(signal);
    
    expect(result.weight).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });
  
  it('maintains monotonicity: higher volume → higher weight', () => {
    const signal1 = createMockSignal({ volumeUsd: 1000 });
    const signal2 = createMockSignal({ volumeUsd: 10000 });
    
    const result1 = resolveEdgeWeight(signal1);
    const result2 = resolveEdgeWeight(signal2);
    
    expect(result2.weight).toBeGreaterThan(result1.weight);
  });
  
  it('maintains monotonicity: higher tx count → higher weight', () => {
    const signal1 = createMockSignal({ txCount: 10 });
    const signal2 = createMockSignal({ txCount: 100 });
    
    const result1 = resolveEdgeWeight(signal1);
    const result2 = resolveEdgeWeight(signal2);
    
    expect(result2.weight).toBeGreaterThan(result1.weight);
  });
  
  it('applies log1p correctly (whale protection)', () => {
    // $1M should not be 1000x more than $1k
    const small = createMockSignal({ volumeUsd: 1000, txCount: 10 });
    const whale = createMockSignal({ volumeUsd: 1000000, txCount: 10 });
    
    const smallWeight = resolveEdgeWeight(small).weight;
    const whaleWeight = resolveEdgeWeight(whale).weight;
    
    // Ratio should be reasonable (log scale)
    const ratio = whaleWeight / smallWeight;
    expect(ratio).toBeLessThan(100); // Not 1000x
    expect(ratio).toBeGreaterThan(1); // But still more
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONFIDENCE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Weight Resolver - Confidence', () => {
  it('ensures confidence ∈ [0, 1]', () => {
    const signals = [
      createMockSignal({ routeConfidence: 0.1 }),
      createMockSignal({ routeConfidence: 0.5 }),
      createMockSignal({ routeConfidence: 0.9 }),
      createMockSignal({ routeConfidence: 1.0 }),
    ];
    
    signals.forEach((signal) => {
      const result = resolveEdgeWeight(signal);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });
  
  it('confidence is multiplicative (weak link principle)', () => {
    const perfect = createMockSignal({
      routeConfidence: 1.0,
      dataQuality: 1.0,
      actorReliability: 1.0,
    });
    
    const weakLink = createMockSignal({
      routeConfidence: 1.0,
      dataQuality: 0.1, // Weak link
      actorReliability: 1.0,
    });
    
    const perfectConf = resolveEdgeWeight(perfect).confidence;
    const weakConf = resolveEdgeWeight(weakLink).confidence;
    
    expect(weakConf).toBeLessThan(perfectConf);
    expect(weakConf).toBeLessThan(0.2); // Dragged down by weak link
  });
  
  it('zero dataQuality → zero confidence', () => {
    const signal = createMockSignal({ dataQuality: 0 });
    const result = resolveEdgeWeight(signal);
    
    expect(result.confidence).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DETERMINISM TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Weight Resolver - Determinism', () => {
  it('same input → same output (deterministic)', () => {
    const signal = createMockSignal();
    
    const result1 = resolveEdgeWeight(signal);
    const result2 = resolveEdgeWeight(signal);
    
    expect(result1.weight).toBe(result2.weight);
    expect(result1.confidence).toBe(result2.confidence);
  });
  
  it('batch processing is consistent with single', () => {
    const signals = [
      createMockSignal({ volumeUsd: 1000 }),
      createMockSignal({ volumeUsd: 5000 }),
      createMockSignal({ volumeUsd: 10000 }),
    ];
    
    // Process individually
    const individual = signals.map((s) => resolveEdgeWeight(s));
    
    // Process in batch
    const batch = resolveEdgeWeightsBatch(signals);
    
    // Compare
    individual.forEach((ind, i) => {
      expect(batch[i].weight).toBe(ind.weight);
      expect(batch[i].confidence).toBe(ind.confidence);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKET MODIFIER TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Weight Resolver - Market Context', () => {
  it('market modifier affects weight', () => {
    const bull = createMockSignal({ marketModifier: 1.5 });
    const neutral = createMockSignal({ marketModifier: 1.0 });
    const bear = createMockSignal({ marketModifier: 0.7 });
    
    const bullWeight = resolveEdgeWeight(bull).weight;
    const neutralWeight = resolveEdgeWeight(neutral).weight;
    const bearWeight = resolveEdgeWeight(bear).weight;
    
    expect(bullWeight).toBeGreaterThan(neutralWeight);
    expect(neutralWeight).toBeGreaterThan(bearWeight);
  });
  
  it('market modifier does not affect confidence', () => {
    const mod1 = createMockSignal({ marketModifier: 0.5 });
    const mod2 = createMockSignal({ marketModifier: 2.0 });
    
    const conf1 = resolveEdgeWeight(mod1).confidence;
    const conf2 = resolveEdgeWeight(mod2).confidence;
    
    // Confidence should be same (market doesn't affect confidence)
    expect(conf1).toBe(conf2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Weight Resolver - Edge Cases', () => {
  it('handles dust volumes (filters correctly)', () => {
    const dust = createMockSignal({ volumeUsd: 0.001, txCount: 1 });
    const result = resolveEdgeWeight(dust);
    
    expect(result.weight).toBe(0);
  });
  
  it('handles zero tx count', () => {
    const signal = createMockSignal({ txCount: 0 });
    const result = resolveEdgeWeight(signal);
    
    expect(result.weight).toBe(0);
  });
  
  it('handles very large volumes gracefully (no overflow)', () => {
    const huge = createMockSignal({ volumeUsd: 1e12, txCount: 1e6 });
    const result = resolveEdgeWeight(huge);
    
    expect(result.weight).toBeFinite();
    expect(result.weight).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Weight Resolver - Validation', () => {
  it('throws on missing required fields', () => {
    const invalid = {
      from: '0xfrom',
      // missing other fields
    } as any;
    
    expect(() => resolveEdgeWeight(invalid)).toThrow();
  });
  
  it('throws on invalid confidence values', () => {
    const invalid = createMockSignal({ routeConfidence: 1.5 }); // > 1
    
    expect(() => resolveEdgeWeight(invalid)).toThrow();
  });
  
  it('throws on negative values', () => {
    const invalid = createMockSignal({ volumeUsd: -100 });
    
    expect(() => resolveEdgeWeight(invalid)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Weight Resolver - Utilities', () => {
  it('getWeightBreakdown returns readable string', () => {
    const signal = createMockSignal();
    const breakdown = getWeightBreakdown(signal);
    
    expect(breakdown).toContain('Base Flow Weight');
    expect(breakdown).toContain('Route Confidence');
    expect(breakdown).toContain('Final Raw Weight');
  });
  
  it('shouldFilterEdge identifies low-quality edges', () => {
    expect(shouldFilterEdge(0, 0.5)).toBe(true); // Zero weight
    expect(shouldFilterEdge(1.0, 0.005)).toBe(true); // Very low confidence
    expect(shouldFilterEdge(1.0, 0.5)).toBe(false); // Good edge
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION SMOKE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Weight Resolver - Integration', () => {
  it('realistic scenario: multiple edges with varied properties', () => {
    const signals = [
      // Major CEX outflow
      createMockSignal({
        volumeUsd: 1000000,
        txCount: 50,
        routeConfidence: 0.95,
        marketModifier: 1.2,
      }),
      // Small wallet activity
      createMockSignal({
        volumeUsd: 500,
        txCount: 2,
        routeConfidence: 0.6,
        marketModifier: 1.0,
      }),
      // Bridge transfer
      createMockSignal({
        volumeUsd: 50000,
        txCount: 5,
        routeConfidence: 0.8,
        marketModifier: 1.1,
      }),
    ];
    
    const results = resolveEdgeWeightsBatch(signals);
    
    // CEX should dominate but not by 2000x
    expect(results[0].weight).toBeGreaterThan(results[1].weight);
    expect(results[0].weight).toBeGreaterThan(results[2].weight);
    
    // All should be valid
    results.forEach((r) => {
      expect(r.weight).toBeFinite();
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    });
  });
});
