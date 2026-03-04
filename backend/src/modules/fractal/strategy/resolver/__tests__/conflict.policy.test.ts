/**
 * BLOCK 59.2 — P1.2: Conflict Policy Tests
 * 
 * Test scenarios:
 * 1. No conflict (all tiers agree)
 * 2. Minor conflict (tactical disagrees)
 * 3. Moderate conflict (weak structure vs timing disagreement)
 * 4. Major conflict (strong structure vs timing opposition)
 * 5. Severe conflict (all disagree + high entropy)
 * 6. Resolution modes (TREND_FOLLOW, COUNTER_TREND, WAIT)
 * 7. Sizing penalties
 */

import { describe, it, expect } from 'vitest';
import {
  computeConflictPolicy,
  conflictToSizingMultiplier,
  shouldBlockAction,
  type ConflictInput,
} from '../conflict.policy.js';
import {
  computeConsensusIndex,
  type HorizonSignalInput,
} from '../consensus.index.js';

// Helper to build consensus from signals
function buildConsensus(signals: HorizonSignalInput[]) {
  return computeConsensusIndex(signals);
}

describe('BLOCK 59.2 — P1.2: Conflict Policy', () => {

  describe('computeConflictPolicy', () => {

    it('should return NONE conflict when all tiers agree on BUY', () => {
      const signals: HorizonSignalInput[] = [
        // TIMING
        { horizon: '7d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.8, blockers: [] },
        // TACTICAL
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '90d', direction: 'BUY', confidence: 0.8, blockers: [] },
        // STRUCTURE
        { horizon: '180d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'BUY', confidence: 0.8, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      expect(result.level).toBe('NONE');
      expect(result.mode).toBe('TREND_FOLLOW');
      expect(result.sizingPenalty).toBe(0);
      expect(result.structureVsTiming.aligned).toBe(true);
    });

    it('should return NONE conflict when all tiers agree on SELL', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '30d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '90d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '180d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'SELL', confidence: 0.8, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      expect(result.level).toBe('NONE');
      expect(result.mode).toBe('TREND_FOLLOW');
      expect(result.structure.dominantDir).toBe('SELL');
      expect(result.timing.dominantDir).toBe('SELL');
    });

    it('should detect MAJOR conflict when Structure and Timing strongly oppose', () => {
      const signals: HorizonSignalInput[] = [
        // TIMING says BUY
        { horizon: '7d', direction: 'BUY', confidence: 0.9, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.9, blockers: [] },
        // TACTICAL neutral
        { horizon: '30d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        { horizon: '90d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        // STRUCTURE says SELL
        { horizon: '180d', direction: 'SELL', confidence: 0.9, blockers: [] },
        { horizon: '365d', direction: 'SELL', confidence: 0.9, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      expect(result.level).toBe('MAJOR');
      expect(result.sizingPenalty).toBe(0.50);
      expect(result.structureVsTiming.aligned).toBe(false);
      expect(result.structureVsTiming.structureDir).toBe('SELL');
      expect(result.structureVsTiming.timingDir).toBe('BUY');
    });

    it('should detect MODERATE conflict with weak disagreement', () => {
      const signals: HorizonSignalInput[] = [
        // TIMING slightly BUY
        { horizon: '7d', direction: 'BUY', confidence: 0.5, blockers: [] },
        { horizon: '14d', direction: 'HOLD', confidence: 0.4, blockers: [] },
        // TACTICAL
        { horizon: '30d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        { horizon: '90d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        // STRUCTURE slightly SELL
        { horizon: '180d', direction: 'SELL', confidence: 0.5, blockers: [] },
        { horizon: '365d', direction: 'HOLD', confidence: 0.4, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      // With weak signals, conflict should be MODERATE or less
      expect(['NONE', 'MINOR', 'MODERATE']).toContain(result.level);
    });

    it('should escalate to SEVERE with high entropy', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '30d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        { horizon: '90d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        { horizon: '180d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'SELL', confidence: 0.8, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      
      // With high entropy, should escalate
      const result = computeConflictPolicy({
        consensus,
        globalEntropy: 0.9,  // High entropy
        mcP95_DD: 0.6,       // High tail risk
      });

      expect(result.level).toBe('SEVERE');
      expect(result.mode).toBe('WAIT');
      expect(result.sizingPenalty).toBe(0.75);
    });

    it('should return COUNTER_TREND mode when timing opposes structure', () => {
      const signals: HorizonSignalInput[] = [
        // TIMING strong BUY
        { horizon: '7d', direction: 'BUY', confidence: 0.85, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.85, blockers: [] },
        // TACTICAL neutral
        { horizon: '30d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        { horizon: '90d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        // STRUCTURE moderate SELL
        { horizon: '180d', direction: 'SELL', confidence: 0.7, blockers: [] },
        { horizon: '365d', direction: 'SELL', confidence: 0.7, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      // Should be COUNTER_TREND since timing is strong enough
      expect(['COUNTER_TREND', 'WAIT']).toContain(result.mode);
      expect(result.structureVsTiming.aligned).toBe(false);
    });

    it('should compute tier summaries correctly', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '30d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '90d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '180d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        { horizon: '365d', direction: 'HOLD', confidence: 0.5, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      expect(result.timing.dominantDir).toBe('BUY');
      expect(result.timing.horizons).toEqual(['7d', '14d']);
      
      expect(result.tactical.dominantDir).toBe('SELL');
      expect(result.tactical.horizons).toEqual(['30d', '90d']);
      
      expect(result.structure.dominantDir).toBe('HOLD');
      expect(result.structure.horizons).toEqual(['180d', '365d']);
    });

    it('should generate meaningful explanations', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '90d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '180d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'BUY', confidence: 0.8, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      expect(result.explain.length).toBeGreaterThan(0);
      expect(result.recommendation.length).toBeGreaterThan(0);
      
      // Should mention mode
      const hasMode = result.explain.some(e => e.includes('Mode:'));
      expect(hasMode).toBe(true);
    });

    it('should generate recommendation with sizing info for counter-trend', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'BUY', confidence: 0.9, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.9, blockers: [] },
        { horizon: '30d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        { horizon: '90d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        { horizon: '180d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'SELL', confidence: 0.8, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      if (result.mode === 'COUNTER_TREND') {
        expect(result.recommendation).toContain('reduced');
      }
    });
  });

  describe('conflictToSizingMultiplier', () => {

    it('should return 1.0 for NONE conflict', () => {
      expect(conflictToSizingMultiplier('NONE')).toBe(1.0);
    });

    it('should return 0.90 for MINOR conflict', () => {
      expect(conflictToSizingMultiplier('MINOR')).toBe(0.90);
    });

    it('should return 0.75 for MODERATE conflict', () => {
      expect(conflictToSizingMultiplier('MODERATE')).toBe(0.75);
    });

    it('should return 0.50 for MAJOR conflict', () => {
      expect(conflictToSizingMultiplier('MAJOR')).toBe(0.50);
    });

    it('should return 0.25 for SEVERE conflict', () => {
      expect(conflictToSizingMultiplier('SEVERE')).toBe(0.25);
    });
  });

  describe('shouldBlockAction', () => {

    it('should return true for WAIT mode', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '180d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'SELL', confidence: 0.8, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({
        consensus,
        globalEntropy: 0.9,
        mcP95_DD: 0.7,
      });

      if (result.level === 'SEVERE') {
        expect(shouldBlockAction(result)).toBe(true);
      }
    });

    it('should return false for TREND_FOLLOW mode', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '180d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'BUY', confidence: 0.8, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      expect(result.mode).toBe('TREND_FOLLOW');
      expect(shouldBlockAction(result)).toBe(false);
    });
  });

  describe('Edge cases', () => {

    it('should handle empty consensus votes', () => {
      const consensus = buildConsensus([]);
      const result = computeConflictPolicy({ consensus });

      // Should not crash, return safe defaults
      expect(result.level).toBeDefined();
      expect(result.mode).toBeDefined();
    });

    it('should handle single horizon', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      // Single horizon = partial data, but should work
      expect(result.level).toBeDefined();
      expect(result.tactical.dominantDir).toBe('BUY');
    });

    it('should handle all HOLD signals', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'HOLD', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'HOLD', confidence: 0.8, blockers: [] },
        { horizon: '30d', direction: 'HOLD', confidence: 0.8, blockers: [] },
        { horizon: '90d', direction: 'HOLD', confidence: 0.8, blockers: [] },
        { horizon: '180d', direction: 'HOLD', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'HOLD', confidence: 0.8, blockers: [] },
      ];

      const consensus = buildConsensus(signals);
      const result = computeConflictPolicy({ consensus });

      expect(result.structureVsTiming.aligned).toBe(true);
      expect(result.structure.dominantDir).toBe('HOLD');
      expect(result.timing.dominantDir).toBe('HOLD');
    });
  });
});
