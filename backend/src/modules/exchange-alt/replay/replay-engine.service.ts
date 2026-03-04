/**
 * BLOCK 8.2-8.4 — Replay Engine Service
 * ======================================
 * 
 * Snapshot builder and outcome tracker for replay/backtest.
 */

import type { IndicatorVector, Venue, Timeframe, PatternCluster } from '../types.js';
import type { MarketContext } from '../ml/ml.types.js';
import type {
  DailySnapshot,
  ReplayOutcome,
  SelectionMetrics,
  PatternValidation,
} from './replay.types.js';
import { labelReplayOutcome } from './replay.types.js';
import { clusterFeatureBuilder } from '../ml/feature-builder.service.js';
import { clusterOutcomeModel } from '../ml/cluster-outcome.model.js';

// ═══════════════════════════════════════════════════════════════
// REPLAY ENGINE SERVICE
// ═══════════════════════════════════════════════════════════════

export class ReplayEngineService {
  
  /**
   * Build snapshot for a single asset at a point in time
   * IMPORTANT: Only uses data available at that time
   */
  async buildSnapshot(
    asset: string,
    date: string,
    vector: IndicatorVector,
    cluster: PatternCluster | null,
    marketContext: MarketContext,
    opportunityScore: number,
    venue: Venue = 'MOCK',
    tf: Timeframe = '1h'
  ): Promise<DailySnapshot> {
    // Get ML prediction (without future knowledge)
    let mlProbUp = 0.5;
    let mlConfidence = 0;

    if (cluster) {
      const features = clusterFeatureBuilder.buildClusterFeatures([vector]);
      const prediction = await clusterOutcomeModel.predict(features, marketContext);
      mlProbUp = prediction.probUP;
      mlConfidence = prediction.confidence;
    }

    return {
      date,
      asset,
      venue,
      tf,
      indicators: vector,
      patternId: cluster?.clusterId ?? 'NO_CLUSTER',
      patternLabel: cluster?.label ?? 'UNKNOWN',
      clusterId: cluster?.clusterId,
      opportunityScore,
      mlProbUp,
      mlConfidence,
      marketContext,
      createdAt: Date.now(),
    };
  }

  /**
   * Build outcome after horizon has passed
   */
  buildOutcome(
    snapshot: DailySnapshot,
    futurePrice: number,
    currentPrice: number,
    horizon: '1d' | '3d' | '7d'
  ): ReplayOutcome {
    const returnPct = ((futurePrice - currentPrice) / currentPrice) * 100;
    const label = labelReplayOutcome(returnPct);

    return {
      asset: snapshot.asset,
      date: snapshot.date,
      horizon,
      returnPct,
      label,
      snapshotId: snapshot._id?.toString(),
      patternId: snapshot.patternId,
      createdAt: Date.now(),
    };
  }

  /**
   * Calculate selection metrics for a date
   */
  calculateMetrics(
    snapshots: DailySnapshot[],
    outcomes: ReplayOutcome[],
    baselineReturns: { random: number[]; topVolume: number[] },
    horizon: '1d' | '3d' | '7d'
  ): SelectionMetrics {
    const date = snapshots[0]?.date ?? new Date().toISOString().split('T')[0];
    
    // Filter outcomes for this horizon
    const relevantOutcomes = outcomes.filter(o => o.horizon === horizon);
    
    // Count picks by label
    const goodPicks = relevantOutcomes.filter(o => o.label === 'GOOD_PICK').length;
    const flatPicks = relevantOutcomes.filter(o => o.label === 'FLAT').length;
    const badPicks = relevantOutcomes.filter(o => o.label === 'BAD_PICK').length;
    const picks = relevantOutcomes.length;

    // Calculate returns
    const returns = relevantOutcomes.map(o => o.returnPct);
    const avgReturn = returns.length > 0 ? this.mean(returns) : 0;
    const medianReturn = returns.length > 0 ? this.median(returns) : 0;

    // Pattern breakdown
    const patternStats: SelectionMetrics['patternStats'] = {};
    for (const outcome of relevantOutcomes) {
      const pid = outcome.patternId;
      if (!patternStats[pid]) {
        patternStats[pid] = { count: 0, goodCount: 0, avgReturn: 0 };
      }
      patternStats[pid].count++;
      if (outcome.label === 'GOOD_PICK') patternStats[pid].goodCount++;
      patternStats[pid].avgReturn = 
        (patternStats[pid].avgReturn * (patternStats[pid].count - 1) + outcome.returnPct) / 
        patternStats[pid].count;
    }

    // Baseline comparison
    const randomAvgReturn = baselineReturns.random.length > 0 ? this.mean(baselineReturns.random) : 0;
    const topVolumeAvgReturn = baselineReturns.topVolume.length > 0 ? this.mean(baselineReturns.topVolume) : 0;
    const outperformance = avgReturn - Math.max(randomAvgReturn, topVolumeAvgReturn);

    return {
      date,
      horizon,
      picks,
      goodPicks,
      flatPicks,
      badPicks,
      precision: picks > 0 ? goodPicks / picks : 0,
      recall: 0, // Would need total good opportunities
      avgReturn,
      medianReturn,
      patternStats,
      vsBaseline: {
        randomAvgReturn,
        topVolumeAvgReturn,
        outperformance,
      },
      createdAt: Date.now(),
    };
  }

  /**
   * Validate patterns based on outcomes
   */
  validatePattern(
    patternId: string,
    patternLabel: string,
    allSnapshots: DailySnapshot[],
    allOutcomes: ReplayOutcome[]
  ): PatternValidation {
    // Get snapshots for this pattern
    const patternSnapshots = allSnapshots.filter(s => s.patternId === patternId);
    const totalOccurrences = patternSnapshots.length;

    // Selected = high opportunity score
    const selectedSnapshots = patternSnapshots.filter(s => s.opportunityScore >= 50);
    const selectedCount = selectedSnapshots.length;

    // Get outcomes for selected
    const selectedAssets = new Set(selectedSnapshots.map(s => `${s.asset}:${s.date}`));
    const selectedOutcomes = allOutcomes.filter(o => selectedAssets.has(`${o.asset}:${o.date}`));
    const successfulSelections = selectedOutcomes.filter(o => o.label === 'GOOD_PICK').length;

    // Calculate rates
    const selectionRate = totalOccurrences > 0 ? selectedCount / totalOccurrences : 0;
    const successRate = selectedCount > 0 ? successfulSelections / selectedCount : 0;
    
    // Missed = good outcome but not selected
    const nonSelectedSnapshots = patternSnapshots.filter(s => s.opportunityScore < 50);
    const nonSelectedAssets = new Set(nonSelectedSnapshots.map(s => `${s.asset}:${s.date}`));
    const nonSelectedOutcomes = allOutcomes.filter(o => nonSelectedAssets.has(`${o.asset}:${o.date}`));
    const missedOpportunities = nonSelectedOutcomes.filter(o => o.label === 'GOOD_PICK').length;

    // Validation score
    const validationScore = successRate * 0.6 + (1 - missedOpportunities / Math.max(1, totalOccurrences)) * 0.4;

    // Recommendation
    let recommendation: PatternValidation['recommendation'];
    let reason: string;

    if (successRate > 0.6 && missedOpportunities > selectedCount * 0.5) {
      recommendation = 'INCREASE_WEIGHT';
      reason = 'Pattern valid but underutilized';
    } else if (successRate < 0.4 && selectedCount >= 10) {
      recommendation = 'DECREASE_WEIGHT';
      reason = 'Low success rate with sufficient samples';
    } else if (successRate < 0.3 && selectedCount >= 20) {
      recommendation = 'FREEZE';
      reason = 'Very low success rate, consider disabling';
    } else {
      recommendation = 'MAINTAIN';
      reason = 'Performance within acceptable range';
    }

    return {
      patternId,
      patternLabel,
      totalOccurrences,
      selectedCount,
      successfulSelections,
      selectionRate,
      successRate,
      missedOpportunities,
      validationScore,
      recommendation,
      reason,
      updatedAt: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ANTI-OVERFITTING TESTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Test T1: Shuffle labels test
   * If metrics don't drop, there's leakage
   */
  shuffleLabelsTest(
    _snapshots: DailySnapshot[],
    outcomes: ReplayOutcome[]
  ): { passed: boolean; originalPrecision: number; shuffledPrecision: number } {
    // Original precision
    const goodCount = outcomes.filter(o => o.label === 'GOOD_PICK').length;
    const originalPrecision = goodCount / outcomes.length;

    // Shuffle outcomes
    const shuffledOutcomes = [...outcomes];
    for (let i = shuffledOutcomes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledOutcomes[i].label, shuffledOutcomes[j].label] = 
        [shuffledOutcomes[j].label, shuffledOutcomes[i].label];
    }

    // Calculate shuffled precision
    const shuffledGoodCount = shuffledOutcomes.filter(o => o.label === 'GOOD_PICK').length;
    const shuffledPrecision = shuffledGoodCount / shuffledOutcomes.length;

    // Should be similar if there's no real signal
    const passed = Math.abs(originalPrecision - shuffledPrecision) > 0.1;

    return { passed, originalPrecision, shuffledPrecision };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}

export const replayEngineService = new ReplayEngineService();

console.log('[Block8] Replay Engine Service loaded');
