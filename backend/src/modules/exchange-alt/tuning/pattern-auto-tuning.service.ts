/**
 * BLOCK 10 — Pattern Weight Auto-Tuning Service
 * ===============================================
 * 
 * Automatically adjusts pattern weights based on performance.
 * No manual tuning required.
 */

import type { PatternWeight } from '../ml/ml.types.js';
import { patternConfidenceService } from '../ml/pattern-confidence.service.js';
import type { ReplayOutcome, PatternValidation } from '../replay/replay.types.js';

// ═══════════════════════════════════════════════════════════════
// AUTO-TUNING CONFIG
// ═══════════════════════════════════════════════════════════════

export const TUNING_CONFIG = {
  // Update limits
  maxUpdatePerDay: 0.10,         // Max 10% weight change per day
  minSamplesForUpdate: 20,       // Need 20+ samples
  rollingWindowDays: 60,         // Use last 60 days
  
  // Freeze thresholds
  freezeHitRate: 0.35,           // Freeze if hit rate below 35%
  unfreezeHitRate: 0.55,         // Unfreeze if hit rate above 55%
  
  // Regime-specific
  enableRegimeWeights: true,
  
  // Baseline
  baselineReturn: 0.02,          // 2% baseline return
} as const;

// ═══════════════════════════════════════════════════════════════
// AUTO-TUNING SERVICE
// ═══════════════════════════════════════════════════════════════

export class PatternAutoTuningService {
  private lastTuneTime: number = 0;
  private tuneHistory: Array<{
    patternId: string;
    oldWeight: number;
    newWeight: number;
    reason: string;
    timestamp: number;
  }> = [];

  /**
   * Run full tuning cycle on all patterns
   */
  async runTuningCycle(
    outcomes: ReplayOutcome[],
    validations: PatternValidation[]
  ): Promise<{
    updated: number;
    frozen: number;
    unfrozen: number;
    changes: Array<{ patternId: string; oldWeight: number; newWeight: number; reason: string }>;
  }> {
    const changes: Array<{ patternId: string; oldWeight: number; newWeight: number; reason: string }> = [];
    let updated = 0;
    let frozen = 0;
    let unfrozen = 0;

    // Group outcomes by pattern
    const outcomesByPattern = new Map<string, ReplayOutcome[]>();
    for (const outcome of outcomes) {
      const existing = outcomesByPattern.get(outcome.patternId) ?? [];
      existing.push(outcome);
      outcomesByPattern.set(outcome.patternId, existing);
    }

    // Process each pattern
    for (const validation of validations) {
      const patternOutcomes = outcomesByPattern.get(validation.patternId) ?? [];
      
      // Calculate metrics
      const metrics = this.calculatePatternMetrics(patternOutcomes);
      
      // Get current weight
      const currentWeight = patternConfidenceService.getPatternWeight(validation.patternId);
      
      // Check if should freeze
      if (metrics.hitRate < TUNING_CONFIG.freezeHitRate && metrics.sampleCount >= TUNING_CONFIG.minSamplesForUpdate) {
        const result = this.freezePattern(validation.patternId, metrics);
        if (result.changed) {
          frozen++;
          changes.push({
            patternId: validation.patternId,
            oldWeight: currentWeight,
            newWeight: 0,
            reason: result.reason,
          });
        }
        continue;
      }

      // Check if should unfreeze
      const existingWeight = patternConfidenceService.getAllPatternWeights()
        .find(w => w.patternId === validation.patternId);
      
      if (existingWeight?.frozen && metrics.hitRate >= TUNING_CONFIG.unfreezeHitRate) {
        this.unfreezePattern(validation.patternId);
        unfrozen++;
        changes.push({
          patternId: validation.patternId,
          oldWeight: 0,
          newWeight: 1.0,
          reason: 'Hit rate recovered',
        });
      }

      // Update weight
      const newWeight = this.calculateNewWeight(currentWeight, metrics);
      
      if (Math.abs(newWeight - currentWeight) > 0.01) {
        patternConfidenceService.updateWeightFromPerformance(
          validation.patternId,
          metrics.hitRate,
          metrics.avgReturn,
          TUNING_CONFIG.baselineReturn
        );
        updated++;
        changes.push({
          patternId: validation.patternId,
          oldWeight: currentWeight,
          newWeight,
          reason: `Hit rate: ${(metrics.hitRate * 100).toFixed(1)}%, Avg return: ${(metrics.avgReturn * 100).toFixed(1)}%`,
        });
      }

      // Update regime-specific weights if enabled
      if (TUNING_CONFIG.enableRegimeWeights) {
        this.updateRegimeWeights(validation.patternId, patternOutcomes);
      }
    }

    this.lastTuneTime = Date.now();
    this.tuneHistory.push(...changes.map(c => ({ ...c, timestamp: Date.now() })));

    // Keep history manageable
    if (this.tuneHistory.length > 1000) {
      this.tuneHistory = this.tuneHistory.slice(-500);
    }

    console.log(`[AutoTuning] Cycle complete: ${updated} updated, ${frozen} frozen, ${unfrozen} unfrozen`);

    return { updated, frozen, unfrozen, changes };
  }

  /**
   * Calculate pattern metrics from outcomes
   */
  private calculatePatternMetrics(outcomes: ReplayOutcome[]): {
    hitRate: number;
    avgReturn: number;
    sampleCount: number;
    consistency: number;
  } {
    if (outcomes.length === 0) {
      return { hitRate: 0.5, avgReturn: 0, sampleCount: 0, consistency: 0 };
    }

    const goodCount = outcomes.filter(o => o.label === 'GOOD_PICK').length;
    const badCount = outcomes.filter(o => o.label === 'BAD_PICK').length;
    const totalDecisive = goodCount + badCount;

    const hitRate = totalDecisive > 0 ? goodCount / totalDecisive : 0.5;
    const avgReturn = outcomes.reduce((sum, o) => sum + o.returnPct, 0) / outcomes.length / 100;

    // Consistency: longest streak of goods
    let streak = 0;
    let maxStreak = 0;
    for (const o of outcomes) {
      if (o.label === 'GOOD_PICK') {
        streak++;
        maxStreak = Math.max(maxStreak, streak);
      } else {
        streak = 0;
      }
    }
    const consistency = outcomes.length > 0 ? maxStreak / outcomes.length : 0;

    return { hitRate, avgReturn, sampleCount: outcomes.length, consistency };
  }

  /**
   * Calculate new weight based on metrics
   */
  private calculateNewWeight(
    currentWeight: number,
    metrics: { hitRate: number; avgReturn: number; sampleCount: number }
  ): number {
    if (metrics.sampleCount < TUNING_CONFIG.minSamplesForUpdate) {
      return currentWeight; // Not enough data
    }

    // delta = (hitRate - 0.5) × 0.8 + (avgReturn - baseline) × 0.5
    const delta = 
      (metrics.hitRate - 0.5) * 0.8 +
      (metrics.avgReturn - TUNING_CONFIG.baselineReturn) * 0.5;

    // Limit update speed
    const limitedDelta = Math.max(-TUNING_CONFIG.maxUpdatePerDay, 
                                   Math.min(TUNING_CONFIG.maxUpdatePerDay, delta));

    // newWeight = clamp(oldWeight × (1 + delta), 0.5, 2.0)
    return Math.max(0.5, Math.min(2.0, currentWeight * (1 + limitedDelta)));
  }

  /**
   * Freeze pattern
   */
  private freezePattern(
    patternId: string,
    metrics: { hitRate: number; sampleCount: number }
  ): { changed: boolean; reason: string } {
    const existing = patternConfidenceService.getAllPatternWeights()
      .find(w => w.patternId === patternId);
    
    if (existing?.frozen) {
      return { changed: false, reason: 'Already frozen' };
    }

    const weight: PatternWeight = {
      patternId,
      patternLabel: patternId,
      weight: 0,
      confidence: 0,
      byRegime: {},
      sampleCount: metrics.sampleCount,
      frozen: true,
      freezeReason: `Hit rate too low: ${(metrics.hitRate * 100).toFixed(1)}%`,
      lastUpdated: Date.now(),
    };

    patternConfidenceService.updatePatternWeight(weight);
    console.log(`[AutoTuning] Froze pattern ${patternId}: hit rate ${(metrics.hitRate * 100).toFixed(1)}%`);

    return { 
      changed: true, 
      reason: `Hit rate too low: ${(metrics.hitRate * 100).toFixed(1)}%` 
    };
  }

  /**
   * Unfreeze pattern
   */
  private unfreezePattern(patternId: string): void {
    const existing = patternConfidenceService.getAllPatternWeights()
      .find(w => w.patternId === patternId);
    
    if (!existing) return;

    const updated: PatternWeight = {
      ...existing,
      weight: 1.0,
      frozen: false,
      freezeReason: undefined,
      lastUpdated: Date.now(),
    };

    patternConfidenceService.updatePatternWeight(updated);
    console.log(`[AutoTuning] Unfroze pattern ${patternId}`);
  }

  /**
   * Update regime-specific weights
   */
  private updateRegimeWeights(_patternId: string, _outcomes: ReplayOutcome[]): void {
    // Group by regime (would need to store regime in outcome)
    // For now, simplified implementation
    // TODO: Add regime tracking to outcomes
  }

  /**
   * Get tuning history
   */
  getTuneHistory(limit: number = 50): typeof this.tuneHistory {
    return this.tuneHistory.slice(-limit);
  }

  /**
   * Get last tune time
   */
  getLastTuneTime(): number {
    return this.lastTuneTime;
  }

  /**
   * Get summary stats
   */
  getSummaryStats(): {
    totalPatterns: number;
    frozenPatterns: number;
    avgWeight: number;
    lastTuneTime: number;
  } {
    const weights = patternConfidenceService.getAllPatternWeights();
    const activeWeights = weights.filter(w => !w.frozen);

    return {
      totalPatterns: weights.length,
      frozenPatterns: weights.filter(w => w.frozen).length,
      avgWeight: activeWeights.length > 0 
        ? activeWeights.reduce((sum, w) => sum + w.weight, 0) / activeWeights.length 
        : 1.0,
      lastTuneTime: this.lastTuneTime,
    };
  }
}

export const patternAutoTuningService = new PatternAutoTuningService();

console.log('[Block10] Pattern Auto-Tuning Service loaded');
