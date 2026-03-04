/**
 * Risk Explain Service Truncation Tests
 * 
 * Tests for summary-only explanation mode when graph is truncated
 */

import { describe, it, expect } from 'vitest';
import type { RiskSummary, GraphEdge, ExplainBlock } from '../storage/graph_types.js';

// ============================================
// Summary-Only Explanation Logic (extracted for testing)
// ============================================

function buildSummaryOnlyExplanation(summary: RiskSummary): ExplainBlock {
  const reasons: any[] = [];
  
  // Only add high-level summary reasons
  if (summary.dumpRiskScore >= 70) {
    reasons.push({
      code: 'HIGH_DUMP_RISK',
      title: 'High Dump Risk Score',
      description: 'Route shows high sell-off probability. Full graph truncated due to size.',
      severity: summary.dumpRiskScore >= 85 ? 'CRITICAL' : 'HIGH',
      evidence: [`Risk score: ${summary.dumpRiskScore}/100`, 'Graph truncated - summary mode']
    });
  }
  
  if (summary.marketRegime === 'STRESSED') {
    reasons.push({
      code: 'MARKET_STRESS_CONTEXT',
      title: 'Exit During Market Stress',
      description: 'Activity during stressed market conditions.',
      severity: 'HIGH',
      evidence: [`Market regime: STRESSED`]
    });
  }
  
  if (summary.exitProbability > 0.7) {
    reasons.push({
      code: 'HIGH_EXIT_PROBABILITY',
      title: 'High Exit Probability',
      description: 'Route characteristics indicate high probability of CEX exit.',
      severity: 'MEDIUM',
      evidence: [`Exit probability: ${(summary.exitProbability * 100).toFixed(0)}%`]
    });
  }
  
  // Add truncation notice
  reasons.push({
    code: 'TRUNCATED_GRAPH',
    title: 'Graph Truncated',
    description: 'Full graph exceeded size limits. Showing summary analysis only.',
    severity: 'LOW',
    evidence: ['Highlighted path preserved', 'Detailed per-edge analysis unavailable']
  });
  
  return {
    reasons,
    amplifiers: summary.marketAmplifier > 1 ? [{
      tag: 'market_conditions',
      multiplier: summary.marketAmplifier,
      source: 'MARKET'
    }] : [],
    suppressors: summary.marketAmplifier < 1 ? [{
      tag: 'stable_market',
      multiplier: summary.marketAmplifier,
      source: 'MARKET'
    }] : []
  };
}

// ============================================
// Test Data
// ============================================

function createRiskSummary(overrides: Partial<RiskSummary> = {}): RiskSummary {
  return {
    exitProbability: 0.5,
    dumpRiskScore: 50,
    pathEntropy: 0.5,
    contextualRiskScore: 50,
    marketAmplifier: 1.0,
    confidenceImpact: 0,
    contextTags: [],
    marketRegime: 'STABLE',
    ...overrides
  };
}

// ============================================
// Tests
// ============================================

describe('Risk Explain Service - Truncation Mode', () => {
  
  describe('Summary-Only Explanation', () => {
    
    it('should always include TRUNCATED_GRAPH reason', () => {
      const summary = createRiskSummary();
      
      const result = buildSummaryOnlyExplanation(summary);
      
      const truncatedReason = result.reasons.find(r => r.code === 'TRUNCATED_GRAPH');
      expect(truncatedReason).toBeDefined();
      expect(truncatedReason.severity).toBe('LOW');
      expect(truncatedReason.evidence).toContain('Highlighted path preserved');
    });
    
    it('should include HIGH_DUMP_RISK when score >= 70', () => {
      const summary = createRiskSummary({ dumpRiskScore: 75 });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      const dumpRiskReason = result.reasons.find(r => r.code === 'HIGH_DUMP_RISK');
      expect(dumpRiskReason).toBeDefined();
      expect(dumpRiskReason.severity).toBe('HIGH');
    });
    
    it('should mark HIGH_DUMP_RISK as CRITICAL when score >= 85', () => {
      const summary = createRiskSummary({ dumpRiskScore: 90 });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      const dumpRiskReason = result.reasons.find(r => r.code === 'HIGH_DUMP_RISK');
      expect(dumpRiskReason.severity).toBe('CRITICAL');
    });
    
    it('should NOT include HIGH_DUMP_RISK when score < 70', () => {
      const summary = createRiskSummary({ dumpRiskScore: 65 });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      const dumpRiskReason = result.reasons.find(r => r.code === 'HIGH_DUMP_RISK');
      expect(dumpRiskReason).toBeUndefined();
    });
    
    it('should include MARKET_STRESS_CONTEXT when regime is STRESSED', () => {
      const summary = createRiskSummary({ marketRegime: 'STRESSED' });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      const stressReason = result.reasons.find(r => r.code === 'MARKET_STRESS_CONTEXT');
      expect(stressReason).toBeDefined();
      expect(stressReason.severity).toBe('HIGH');
    });
    
    it('should NOT include MARKET_STRESS_CONTEXT when regime is STABLE', () => {
      const summary = createRiskSummary({ marketRegime: 'STABLE' });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      const stressReason = result.reasons.find(r => r.code === 'MARKET_STRESS_CONTEXT');
      expect(stressReason).toBeUndefined();
    });
    
    it('should include HIGH_EXIT_PROBABILITY when > 0.7', () => {
      const summary = createRiskSummary({ exitProbability: 0.8 });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      const exitReason = result.reasons.find(r => r.code === 'HIGH_EXIT_PROBABILITY');
      expect(exitReason).toBeDefined();
      expect(exitReason.severity).toBe('MEDIUM');
      expect(exitReason.evidence[0]).toBe('Exit probability: 80%');
    });
  });
  
  describe('Amplifiers and Suppressors', () => {
    
    it('should add market_conditions amplifier when marketAmplifier > 1', () => {
      const summary = createRiskSummary({ marketAmplifier: 1.2 });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      expect(result.amplifiers).toHaveLength(1);
      expect(result.amplifiers[0].tag).toBe('market_conditions');
      expect(result.amplifiers[0].multiplier).toBe(1.2);
      expect(result.suppressors).toHaveLength(0);
    });
    
    it('should add stable_market suppressor when marketAmplifier < 1', () => {
      const summary = createRiskSummary({ marketAmplifier: 0.9 });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      expect(result.suppressors).toHaveLength(1);
      expect(result.suppressors[0].tag).toBe('stable_market');
      expect(result.suppressors[0].multiplier).toBe(0.9);
      expect(result.amplifiers).toHaveLength(0);
    });
    
    it('should have no amplifiers/suppressors when marketAmplifier is exactly 1', () => {
      const summary = createRiskSummary({ marketAmplifier: 1.0 });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      expect(result.amplifiers).toHaveLength(0);
      expect(result.suppressors).toHaveLength(0);
    });
  });
  
  describe('Combined Scenarios', () => {
    
    it('should include all relevant reasons for high-risk truncated graph', () => {
      const summary = createRiskSummary({
        dumpRiskScore: 88,
        exitProbability: 0.85,
        marketRegime: 'STRESSED',
        marketAmplifier: 1.3
      });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      // Should have 4 reasons: DUMP, STRESS, EXIT, TRUNCATED
      expect(result.reasons).toHaveLength(4);
      
      const codes = result.reasons.map(r => r.code);
      expect(codes).toContain('HIGH_DUMP_RISK');
      expect(codes).toContain('MARKET_STRESS_CONTEXT');
      expect(codes).toContain('HIGH_EXIT_PROBABILITY');
      expect(codes).toContain('TRUNCATED_GRAPH');
      
      // Should have amplifier
      expect(result.amplifiers).toHaveLength(1);
    });
    
    it('should only include TRUNCATED_GRAPH for low-risk truncated graph', () => {
      const summary = createRiskSummary({
        dumpRiskScore: 30,
        exitProbability: 0.3,
        marketRegime: 'STABLE',
        marketAmplifier: 1.0
      });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      // Should only have TRUNCATED reason
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0].code).toBe('TRUNCATED_GRAPH');
      
      expect(result.amplifiers).toHaveLength(0);
      expect(result.suppressors).toHaveLength(0);
    });
    
    it('should handle volatile market regime correctly', () => {
      const summary = createRiskSummary({
        marketRegime: 'VOLATILE',
        marketAmplifier: 1.15
      });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      // VOLATILE != STRESSED, so no MARKET_STRESS_CONTEXT
      const stressReason = result.reasons.find(r => r.code === 'MARKET_STRESS_CONTEXT');
      expect(stressReason).toBeUndefined();
      
      // But amplifier should still be present
      expect(result.amplifiers).toHaveLength(1);
    });
  });
  
  describe('Evidence Formatting', () => {
    
    it('should format exit probability as percentage', () => {
      const summary = createRiskSummary({ exitProbability: 0.756 });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      const exitReason = result.reasons.find(r => r.code === 'HIGH_EXIT_PROBABILITY');
      expect(exitReason.evidence[0]).toBe('Exit probability: 76%');
    });
    
    it('should include truncation notice in evidence', () => {
      const summary = createRiskSummary({ dumpRiskScore: 80 });
      
      const result = buildSummaryOnlyExplanation(summary);
      
      const dumpReason = result.reasons.find(r => r.code === 'HIGH_DUMP_RISK');
      expect(dumpReason.evidence).toContain('Graph truncated - summary mode');
    });
  });
});
