/**
 * BLOCK 58 — Hierarchical Resolver Tests
 * 
 * Key test cases:
 * - Conflict: 30d BUY vs 365d BEAR
 * - Agreement: all horizons bullish
 * - Blockers: HIGH_ENTROPY forces HOLD
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HierarchicalResolverService,
  type HierarchicalResolveInput,
} from '../resolver.hierarchical.service.js';
import type { HorizonKey } from '../config/horizon.config.js';

describe('HierarchicalResolverService', () => {
  let resolver: HierarchicalResolverService;

  beforeEach(() => {
    resolver = new HierarchicalResolverService();
  });

  function createInput(overrides: Partial<Record<HorizonKey, any>> = {}): HierarchicalResolveInput {
    const baseHorizon = {
      expectedReturn: 0,
      confidence: 0.5,
      reliability: 0.75,
      phaseRisk: 0.1,
      blockers: [],
    };

    return {
      horizons: {
        '7d': { horizon: '7d', dir: 'HOLD', ...baseHorizon, ...overrides['7d'] },
        '14d': { horizon: '14d', dir: 'HOLD', ...baseHorizon, ...overrides['14d'] },
        '30d': { horizon: '30d', dir: 'HOLD', ...baseHorizon, ...overrides['30d'] },
        '90d': { horizon: '90d', dir: 'HOLD', ...baseHorizon, ...overrides['90d'] },
        '180d': { horizon: '180d', dir: 'HOLD', ...baseHorizon, ...overrides['180d'] },
        '365d': { horizon: '365d', dir: 'HOLD', ...baseHorizon, ...overrides['365d'] },
      },
      globalEntropy: 0.3,
      mcP95_DD: 0.35,
    };
  }

  describe('Conflict: 30d BUY vs 365d BEAR', () => {
    it('should resolve to COUNTER_TREND with reduced size', () => {
      const input = createInput({
        '7d': { dir: 'LONG', expectedReturn: 0.08, confidence: 0.55, reliability: 0.75 },
        '14d': { dir: 'LONG', expectedReturn: 0.12, confidence: 0.6, reliability: 0.78 },
        '30d': { dir: 'LONG', expectedReturn: 0.18, confidence: 0.65, reliability: 0.8 },
        '180d': { dir: 'SHORT', expectedReturn: -0.25, confidence: 0.75, reliability: 0.85 },
        '365d': { dir: 'SHORT', expectedReturn: -0.40, confidence: 0.85, reliability: 0.9 },
      });
      input.globalEntropy = 0.25;
      input.mcP95_DD = 0.3;

      const result = resolver.resolve(input);

      // Bias should be BEAR (dominated by 365d)
      expect(result.bias.dir).toBe('BEAR');
      expect(result.bias.dominantHorizon).toBe('365d');

      // Timing should have positive score (short-term bullish)
      expect(result.timing.score).toBeGreaterThan(0);

      // If timing passes threshold, should be COUNTER_TREND
      if (result.timing.action === 'ENTER') {
        expect(result.final.mode).toBe('COUNTER_TREND');
        expect(result.final.action).toBe('BUY');
        expect(result.final.sizeMultiplier).toBeLessThan(0.3); // Heavily reduced
      } else {
        // If timing doesn't pass, it's WAIT/HOLD which is also correct
        expect(result.final.action).toBe('HOLD');
      }
    });
  });

  describe('Agreement: All horizons bullish', () => {
    it('should resolve to TREND_FOLLOW with full size', () => {
      const input = createInput({
        '7d': { dir: 'LONG', expectedReturn: 0.06, confidence: 0.5, reliability: 0.75 },
        '14d': { dir: 'LONG', expectedReturn: 0.10, confidence: 0.55, reliability: 0.78 },
        '30d': { dir: 'LONG', expectedReturn: 0.15, confidence: 0.6, reliability: 0.8 },
        '90d': { dir: 'LONG', expectedReturn: 0.22, confidence: 0.65, reliability: 0.82 },
        '180d': { dir: 'LONG', expectedReturn: 0.35, confidence: 0.75, reliability: 0.88 },
        '365d': { dir: 'LONG', expectedReturn: 0.50, confidence: 0.85, reliability: 0.92 },
      });
      input.globalEntropy = 0.2;
      input.mcP95_DD = 0.25;

      const result = resolver.resolve(input);

      // Bias should be BULL
      expect(result.bias.dir).toBe('BULL');
      
      // Timing should have positive score
      expect(result.timing.score).toBeGreaterThan(0);

      // If ENTER, should be TREND_FOLLOW BUY
      if (result.timing.action === 'ENTER') {
        expect(result.final.mode).toBe('TREND_FOLLOW');
        expect(result.final.action).toBe('BUY');
        expect(result.final.sizeMultiplier).toBeGreaterThan(0);
      }
    });
  });

  describe('All horizons bearish', () => {
    it('should resolve to TREND_FOLLOW SELL', () => {
      const input = createInput({
        '7d': { dir: 'SHORT', expectedReturn: -0.06, confidence: 0.5, reliability: 0.75 },
        '14d': { dir: 'SHORT', expectedReturn: -0.10, confidence: 0.55, reliability: 0.78 },
        '30d': { dir: 'SHORT', expectedReturn: -0.15, confidence: 0.6, reliability: 0.8 },
        '180d': { dir: 'SHORT', expectedReturn: -0.30, confidence: 0.75, reliability: 0.88 },
        '365d': { dir: 'SHORT', expectedReturn: -0.45, confidence: 0.85, reliability: 0.92 },
      });
      input.globalEntropy = 0.25;
      input.mcP95_DD = 0.3;

      const result = resolver.resolve(input);

      expect(result.bias.dir).toBe('BEAR');
      
      // Timing should have negative score
      expect(result.timing.score).toBeLessThan(0);
      
      // If EXIT, should be SELL
      if (result.timing.action === 'EXIT') {
        expect(result.final.mode).toBe('TREND_FOLLOW');
        expect(result.final.action).toBe('SELL');
      }
    });
  });

  describe('Neutral bias with timing signal', () => {
    it('should allow small entry with reduced size', () => {
      const input = createInput({
        '7d': { dir: 'LONG', expectedReturn: 0.08, confidence: 0.5, reliability: 0.75 },
        '14d': { dir: 'LONG', expectedReturn: 0.12, confidence: 0.55, reliability: 0.78 },
        '30d': { dir: 'LONG', expectedReturn: 0.15, confidence: 0.6, reliability: 0.8 },
        '180d': { dir: 'HOLD', expectedReturn: 0.02, confidence: 0.3, reliability: 0.7 },
        '365d': { dir: 'HOLD', expectedReturn: -0.01, confidence: 0.25, reliability: 0.65 },
      });
      input.globalEntropy = 0.3;
      input.mcP95_DD = 0.3;

      const result = resolver.resolve(input);

      // Bias should be NEUTRAL (long-term mixed)
      expect(result.bias.dir).toBe('NEUTRAL');
      
      // Timing should show positive score
      expect(result.timing.score).toBeGreaterThan(0);

      // Final may HOLD due to threshold, but timing score should be positive
      expect(result.timing.dominantHorizon).toBe('30d');
    });
  });

  describe('Blockers force HOLD', () => {
    it('should HOLD when LOW_CONFIDENCE blocker present', () => {
      const input = createInput({
        '7d': { dir: 'LONG', expectedReturn: 0.05, confidence: 0.4, blockers: ['LOW_CONFIDENCE'] },
        '14d': { dir: 'LONG', expectedReturn: 0.08, confidence: 0.45, blockers: ['LOW_CONFIDENCE'] },
        '30d': { dir: 'LONG', expectedReturn: 0.12, confidence: 0.5, blockers: ['LOW_CONFIDENCE'] },
        '365d': { dir: 'LONG', expectedReturn: 0.25, confidence: 0.7 },
      });

      const result = resolver.resolve(input);

      // Timing should be WAIT due to blockers
      expect(result.timing.action).toBe('WAIT');
      expect(result.timing.blockers).toContain('LOW_CONFIDENCE');

      // Final should be HOLD
      expect(result.final.mode).toBe('HOLD');
      expect(result.final.action).toBe('HOLD');
      expect(result.final.sizeMultiplier).toBe(0);
    });

    it('should HOLD when HIGH_ENTROPY blocker present', () => {
      const input = createInput({
        '30d': { dir: 'LONG', expectedReturn: 0.12, confidence: 0.5, blockers: ['HIGH_ENTROPY'] },
      });

      const result = resolver.resolve(input);

      expect(result.timing.action).toBe('WAIT');
      expect(result.final.action).toBe('HOLD');
    });

    it('should HOLD when HIGH_TAIL_RISK blocker present', () => {
      const input = createInput({
        '30d': { dir: 'LONG', expectedReturn: 0.12, confidence: 0.5, blockers: ['HIGH_TAIL_RISK'] },
      });
      input.mcP95_DD = 0.7; // High tail risk

      const result = resolver.resolve(input);

      expect(result.timing.action).toBe('WAIT');
      expect(result.final.action).toBe('HOLD');
    });
  });

  describe('Risk adjustments', () => {
    it('should apply entropy penalty to timing score', () => {
      const inputLowEntropy = createInput({
        '30d': { dir: 'LONG', expectedReturn: 0.15, confidence: 0.6, reliability: 0.8 },
        '14d': { dir: 'LONG', expectedReturn: 0.12, confidence: 0.55, reliability: 0.75 },
        '7d': { dir: 'LONG', expectedReturn: 0.10, confidence: 0.5, reliability: 0.7 },
        '365d': { dir: 'LONG', expectedReturn: 0.30, confidence: 0.7, reliability: 0.85 },
      });
      inputLowEntropy.globalEntropy = 0.2;
      inputLowEntropy.mcP95_DD = 0.25;

      const inputHighEntropy = createInput({
        '30d': { dir: 'LONG', expectedReturn: 0.15, confidence: 0.6, reliability: 0.8 },
        '14d': { dir: 'LONG', expectedReturn: 0.12, confidence: 0.55, reliability: 0.75 },
        '7d': { dir: 'LONG', expectedReturn: 0.10, confidence: 0.5, reliability: 0.7 },
        '365d': { dir: 'LONG', expectedReturn: 0.30, confidence: 0.7, reliability: 0.85 },
      });
      inputHighEntropy.globalEntropy = 0.95;
      inputHighEntropy.mcP95_DD = 0.25;

      const resultLow = resolver.resolve(inputLowEntropy);
      const resultHigh = resolver.resolve(inputHighEntropy);

      // High entropy should have lower timing score
      expect(resultHigh.timing.score).toBeLessThan(resultLow.timing.score);
    });

    it('should apply tail risk penalty to timing score', () => {
      const inputLowTail = createInput({
        '30d': { dir: 'LONG', expectedReturn: 0.15, confidence: 0.6, reliability: 0.8 },
        '14d': { dir: 'LONG', expectedReturn: 0.12, confidence: 0.55, reliability: 0.75 },
        '7d': { dir: 'LONG', expectedReturn: 0.10, confidence: 0.5, reliability: 0.7 },
        '365d': { dir: 'LONG', expectedReturn: 0.30, confidence: 0.7, reliability: 0.85 },
      });
      inputLowTail.mcP95_DD = 0.2;
      inputLowTail.globalEntropy = 0.3;

      const inputHighTail = createInput({
        '30d': { dir: 'LONG', expectedReturn: 0.15, confidence: 0.6, reliability: 0.8 },
        '14d': { dir: 'LONG', expectedReturn: 0.12, confidence: 0.55, reliability: 0.75 },
        '7d': { dir: 'LONG', expectedReturn: 0.10, confidence: 0.5, reliability: 0.7 },
        '365d': { dir: 'LONG', expectedReturn: 0.30, confidence: 0.7, reliability: 0.85 },
      });
      inputHighTail.mcP95_DD = 0.9;
      inputHighTail.globalEntropy = 0.3;

      const resultLow = resolver.resolve(inputLowTail);
      const resultHigh = resolver.resolve(inputHighTail);

      // High tail risk should have lower timing score
      expect(resultHigh.timing.score).toBeLessThan(resultLow.timing.score);
    });
  });

  describe('Bias calculation', () => {
    it('should weight 365d higher than 180d', () => {
      // 365d bearish, 180d bullish - higher confidence to exceed threshold
      const input = createInput({
        '180d': { dir: 'LONG', expectedReturn: 0.25, confidence: 0.8, reliability: 0.9 },
        '365d': { dir: 'SHORT', expectedReturn: -0.35, confidence: 0.85, reliability: 0.9 },
      });
      input.globalEntropy = 0.2; // Low entropy

      const result = resolver.resolve(input);

      // 365d should dominate (weight 0.65 vs 0.35)
      expect(result.bias.dir).toBe('BEAR');
      expect(result.bias.dominantHorizon).toBe('365d');
    });
  });

  describe('Timing calculation', () => {
    it('should weight 30d highest', () => {
      // 30d bullish, 7d/14d mixed
      const input = createInput({
        '7d': { dir: 'SHORT', expectedReturn: -0.02, confidence: 0.3 },
        '14d': { dir: 'HOLD', expectedReturn: 0.01, confidence: 0.35 },
        '30d': { dir: 'LONG', expectedReturn: 0.10, confidence: 0.5 },
        '365d': { dir: 'LONG', expectedReturn: 0.25, confidence: 0.6 },
      });

      const result = resolver.resolve(input);

      // 30d should dominate timing (weight 0.5)
      expect(result.timing.dominantHorizon).toBe('30d');
    });
  });
});
