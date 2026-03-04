/**
 * BLOCK 59.2 — P1.1: Consensus Index Tests
 * 
 * Test scenarios:
 * 1. Full agreement (all BUY) → high score
 * 2. Full disagreement (mixed) → low score
 * 3. Penalty application → reduced weight
 * 4. Tier weighting → STRUCTURE > TACTICAL > TIMING
 * 5. Edge cases (empty input, single horizon)
 */

import { describe, it, expect } from 'vitest';
import {
  computeConsensusIndex,
  consensusToMultiplier,
  type HorizonSignalInput,
} from '../consensus.index.js';

describe('BLOCK 59.2 — P1.1: Consensus Index', () => {

  describe('computeConsensusIndex', () => {

    it('should return high score when all horizons agree on BUY', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '90d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '180d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'BUY', confidence: 0.8, blockers: [] },
      ];

      const result = computeConsensusIndex(signals);

      expect(result.dir).toBe('BUY');
      expect(result.score).toBeGreaterThan(0.9); // High agreement
      expect(result.dispersion).toBeLessThan(0.1);
      expect(result.buyWeight).toBeGreaterThan(0);
      expect(result.sellWeight).toBe(0);
      expect(result.votes).toHaveLength(6);
    });

    it('should return high score when all horizons agree on SELL', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '30d', direction: 'SELL', confidence: 0.7, blockers: [] },
        { horizon: '90d', direction: 'SELL', confidence: 0.7, blockers: [] },
        { horizon: '180d', direction: 'SELL', confidence: 0.6, blockers: [] },
        { horizon: '365d', direction: 'SELL', confidence: 0.6, blockers: [] },
      ];

      const result = computeConsensusIndex(signals);

      expect(result.dir).toBe('SELL');
      expect(result.score).toBeGreaterThan(0.9);
      expect(result.sellWeight).toBeGreaterThan(0);
      expect(result.buyWeight).toBe(0);
    });

    it('should return low score when horizons disagree (50/50 split)', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '90d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '180d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'SELL', confidence: 0.8, blockers: [] },
      ];

      const result = computeConsensusIndex(signals);

      // Should have moderate score due to mixed signals
      expect(result.score).toBeGreaterThan(0.4);
      expect(result.score).toBeLessThan(0.7);
      expect(result.dispersion).toBeGreaterThan(0.3);
    });

    it('should weight STRUCTURE tier higher than TIMING', () => {
      // STRUCTURE (180d, 365d) says SELL, TIMING (7d, 14d) says BUY
      const signals: HorizonSignalInput[] = [
        { horizon: '7d', direction: 'BUY', confidence: 0.9, blockers: [] },
        { horizon: '14d', direction: 'BUY', confidence: 0.9, blockers: [] },
        { horizon: '30d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        { horizon: '90d', direction: 'HOLD', confidence: 0.5, blockers: [] },
        { horizon: '180d', direction: 'SELL', confidence: 0.9, blockers: [] },
        { horizon: '365d', direction: 'SELL', confidence: 0.9, blockers: [] },
      ];

      const result = computeConsensusIndex(signals);

      // STRUCTURE has 40% weight, TIMING has 25%
      // With equal confidence, SELL should dominate
      expect(result.sellWeight).toBeGreaterThan(result.buyWeight);
    });

    it('should apply LOW_CONFIDENCE penalty to reduce weight', () => {
      const signalsWithPenalty: HorizonSignalInput[] = [
        { horizon: '180d', direction: 'BUY', confidence: 0.8, blockers: ['LOW_CONFIDENCE'] },
        { horizon: '365d', direction: 'BUY', confidence: 0.8, blockers: [] },
      ];

      const signalsNoPenalty: HorizonSignalInput[] = [
        { horizon: '180d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '365d', direction: 'BUY', confidence: 0.8, blockers: [] },
      ];

      const withPenalty = computeConsensusIndex(signalsWithPenalty);
      const noPenalty = computeConsensusIndex(signalsNoPenalty);

      // Weight with penalty should be lower
      expect(withPenalty.buyWeight).toBeLessThan(noPenalty.buyWeight);
      
      // Check penalty applied in votes
      const vote180 = withPenalty.votes.find(v => v.horizon === '180d');
      expect(vote180?.penalties).toContain('LOW_CONFIDENCE');
      expect(vote180?.penaltyTotal).toBeGreaterThan(0);
    });

    it('should apply HIGH_ENTROPY penalty', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: ['HIGH_ENTROPY'] },
      ];

      const result = computeConsensusIndex(signals);

      const vote = result.votes[0];
      expect(vote.penalties).toContain('HIGH_ENTROPY');
      expect(vote.penaltyTotal).toBe(0.25); // HIGH_ENTROPY penalty
    });

    it('should apply multiple penalties cumulatively', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: ['LOW_CONFIDENCE', 'HIGH_ENTROPY'] },
      ];

      const result = computeConsensusIndex(signals);

      const vote = result.votes[0];
      expect(vote.penalties).toContain('LOW_CONFIDENCE');
      expect(vote.penalties).toContain('HIGH_ENTROPY');
      expect(vote.penaltyTotal).toBe(0.35 + 0.25); // Combined
    });

    it('should cap penalty at 1.0', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: [
          'LOW_CONFIDENCE', 'HIGH_ENTROPY', 'HIGH_TAIL_RISK', 'DEGRADED_RELIABILITY'
        ]},
      ];

      const result = computeConsensusIndex(signals);

      const vote = result.votes[0];
      expect(vote.penaltyTotal).toBe(1); // Capped
      expect(vote.effectiveWeight).toBe(0); // Zero effective weight
    });

    it('should handle empty input', () => {
      const result = computeConsensusIndex([]);

      expect(result.score).toBe(0);
      // With no input, default dir is BUY (first in comparison chain)
      expect(result.dir).toBe('BUY');
      expect(result.votes).toHaveLength(0);
    });

    it('should handle single horizon input', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: [] },
      ];

      const result = computeConsensusIndex(signals);

      expect(result.dir).toBe('BUY');
      // Score is close to 1 due to epsilon in denominator
      expect(result.score).toBeGreaterThan(0.99);
      expect(result.votes).toHaveLength(1);
    });

    it('should use reliability modifier', () => {
      const highReliability: HorizonSignalInput[] = [
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: [], reliability: 1.0 },
      ];

      const lowReliability: HorizonSignalInput[] = [
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: [], reliability: 0.5 },
      ];

      const highResult = computeConsensusIndex(highReliability);
      const lowResult = computeConsensusIndex(lowReliability);

      expect(highResult.buyWeight).toBeGreaterThan(lowResult.buyWeight);
    });

    it('should calculate contribution with correct sign', () => {
      const signals: HorizonSignalInput[] = [
        { horizon: '30d', direction: 'BUY', confidence: 0.8, blockers: [] },
        { horizon: '90d', direction: 'SELL', confidence: 0.8, blockers: [] },
        { horizon: '180d', direction: 'HOLD', confidence: 0.8, blockers: [] },
      ];

      const result = computeConsensusIndex(signals);

      const buyVote = result.votes.find(v => v.direction === 'BUY');
      const sellVote = result.votes.find(v => v.direction === 'SELL');
      const holdVote = result.votes.find(v => v.direction === 'HOLD');

      expect(buyVote?.contribution).toBeGreaterThan(0);  // Positive
      expect(sellVote?.contribution).toBeLessThan(0);    // Negative
      expect(holdVote?.contribution).toBe(0);            // Zero
    });
  });

  describe('consensusToMultiplier', () => {

    it('should return low multiplier for low consensus', () => {
      const mult = consensusToMultiplier(0.2);
      expect(mult).toBeCloseTo(0.2, 1); // Near minimum
    });

    it('should return medium multiplier for medium consensus', () => {
      const mult = consensusToMultiplier(0.5);
      expect(mult).toBeGreaterThan(0.4);
      expect(mult).toBeLessThan(0.7);
    });

    it('should return high multiplier for high consensus', () => {
      const mult = consensusToMultiplier(0.9);
      expect(mult).toBeGreaterThan(0.9);
      expect(mult).toBeLessThanOrEqual(1.0);
    });

    it('should return 1.0 for perfect consensus', () => {
      const mult = consensusToMultiplier(1.0);
      expect(mult).toBe(1.0);
    });

    it('should return minimum for zero consensus', () => {
      const mult = consensusToMultiplier(0);
      expect(mult).toBe(0.2); // Minimum multiplier
    });

    it('should use smoothstep curve (gradual transition)', () => {
      // Smoothstep should produce smooth curve, not linear
      const m1 = consensusToMultiplier(0.3);
      const m2 = consensusToMultiplier(0.5);
      const m3 = consensusToMultiplier(0.7);

      // Verify non-linearity
      const linear = (m1 + m3) / 2;
      expect(Math.abs(m2 - linear)).toBeGreaterThan(0.01); // Not exactly linear
    });
  });
});
