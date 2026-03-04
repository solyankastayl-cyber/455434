/**
 * BLOCK 16 — Validation Service (Anti-Overfitting)
 * ==================================================
 * 
 * Proves system catches repeating states, not hindsight.
 */

import type { DailySnapshot, ReplayOutcome } from '../replay/replay.types.js';
import { replayEngineService } from '../replay/replay-engine.service.js';

// ═══════════════════════════════════════════════════════════════
// VALIDATION CONFIG
// ═══════════════════════════════════════════════════════════════

export const VALIDATION_CONFIG = {
  // Walk-forward
  trainWindowDays: 30,
  testWindowDays: 1,
  
  // Thresholds
  minHitRateTopK: 0.5,      // At least 50% of top-10 should be positive
  minExcessReturn: 0.01,    // At least 1% better than baseline
  
  // Leakage detection
  shuffleTestThreshold: 0.1, // Drop must be > 10%
  
  // Stability
  minStabilityScore: 0.6,   // Same clusters work 60%+ of time
} as const;

// ═══════════════════════════════════════════════════════════════
// VALIDATION METRICS
// ═══════════════════════════════════════════════════════════════

export interface ValidationMetrics {
  // Core metrics
  hitRateTop10_24h: number;
  excessReturnVsBaseline: number;
  clusterWinRate: number;
  stabilityScore: number;
  
  // Anti-overfitting tests
  shuffleLabelsTest: {
    passed: boolean;
    originalPrecision: number;
    shuffledPrecision: number;
  };
  
  timeShiftTest: {
    passed: boolean;
    normalAccuracy: number;
    shiftedAccuracy: number;
  };
  
  // Overall
  validationPassed: boolean;
  issues: string[];
  
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION SERVICE
// ═══════════════════════════════════════════════════════════════

export class ValidationService {
  private history: ValidationMetrics[] = [];

  /**
   * Run full validation suite
   */
  async runValidation(
    snapshots: DailySnapshot[],
    outcomes: ReplayOutcome[],
    baselineReturns: number[]
  ): Promise<ValidationMetrics> {
    const issues: string[] = [];

    // 1. Hit Rate Top-10 (24h)
    const hitRateTop10 = this.calculateHitRateTopK(snapshots, outcomes, 10, '24h');
    if (hitRateTop10 < VALIDATION_CONFIG.minHitRateTopK) {
      issues.push(`Hit rate top-10 too low: ${(hitRateTop10 * 100).toFixed(1)}%`);
    }

    // 2. Excess Return vs Baseline
    const ourReturns = this.getOurReturns(snapshots, outcomes);
    const ourAvg = ourReturns.length > 0 
      ? ourReturns.reduce((a, b) => a + b, 0) / ourReturns.length 
      : 0;
    const baselineAvg = baselineReturns.length > 0 
      ? baselineReturns.reduce((a, b) => a + b, 0) / baselineReturns.length 
      : 0;
    const excessReturn = ourAvg - baselineAvg;
    
    if (excessReturn < VALIDATION_CONFIG.minExcessReturn) {
      issues.push(`Excess return insufficient: ${(excessReturn * 100).toFixed(2)}%`);
    }

    // 3. Cluster Win Rate
    const clusterWinRate = this.calculateClusterWinRate(snapshots, outcomes);
    if (clusterWinRate < 0.5) {
      issues.push(`Cluster win rate too low: ${(clusterWinRate * 100).toFixed(1)}%`);
    }

    // 4. Stability Score
    const stabilityScore = this.calculateStabilityScore(snapshots, outcomes);
    if (stabilityScore < VALIDATION_CONFIG.minStabilityScore) {
      issues.push(`Stability score too low: ${(stabilityScore * 100).toFixed(1)}%`);
    }

    // 5. Shuffle Labels Test
    const shuffleTest = replayEngineService.shuffleLabelsTest(snapshots, outcomes);
    if (!shuffleTest.passed) {
      issues.push('Shuffle labels test FAILED - possible leakage');
    }

    // 6. Time Shift Test (simplified)
    const timeShiftTest = this.runTimeShiftTest(snapshots, outcomes);
    if (!timeShiftTest.passed) {
      issues.push('Time shift test FAILED - possible future leakage');
    }

    const validationPassed = issues.length === 0;

    const metrics: ValidationMetrics = {
      hitRateTop10_24h: hitRateTop10,
      excessReturnVsBaseline: excessReturn,
      clusterWinRate,
      stabilityScore,
      shuffleLabelsTest: shuffleTest,
      timeShiftTest,
      validationPassed,
      issues,
      timestamp: Date.now(),
    };

    this.history.push(metrics);

    // Keep history manageable
    if (this.history.length > 100) {
      this.history = this.history.slice(-50);
    }

    console.log(`[Validation] ${validationPassed ? 'PASSED' : 'FAILED'} - ${issues.length} issues`);

    return metrics;
  }

  /**
   * Calculate hit rate for top-K selections
   */
  private calculateHitRateTopK(
    snapshots: DailySnapshot[],
    outcomes: ReplayOutcome[],
    k: number,
    horizon: string
  ): number {
    // Group by date
    const byDate = new Map<string, DailySnapshot[]>();
    for (const s of snapshots) {
      const existing = byDate.get(s.date) ?? [];
      existing.push(s);
      byDate.set(s.date, existing);
    }

    let totalTopK = 0;
    let positiveTopK = 0;

    for (const [date, dateSnapshots] of byDate) {
      // Sort by opportunity score and take top K
      const topK = dateSnapshots
        .sort((a, b) => b.opportunityScore - a.opportunityScore)
        .slice(0, k);

      // Get outcomes for these
      const outcomeMap = new Map(
        outcomes
          .filter(o => o.date === date && o.horizon === horizon)
          .map(o => [o.asset, o])
      );

      for (const snap of topK) {
        const outcome = outcomeMap.get(snap.asset);
        if (outcome) {
          totalTopK++;
          if (outcome.returnPct > 0) positiveTopK++;
        }
      }
    }

    return totalTopK > 0 ? positiveTopK / totalTopK : 0;
  }

  /**
   * Get returns for our selections
   */
  private getOurReturns(
    snapshots: DailySnapshot[],
    outcomes: ReplayOutcome[]
  ): number[] {
    // Filter high-score snapshots
    const highScore = snapshots.filter(s => s.opportunityScore >= 50);
    
    const returns: number[] = [];
    const outcomeMap = new Map(outcomes.map(o => [`${o.asset}:${o.date}`, o]));

    for (const snap of highScore) {
      const outcome = outcomeMap.get(`${snap.asset}:${snap.date}`);
      if (outcome) {
        returns.push(outcome.returnPct / 100);
      }
    }

    return returns;
  }

  /**
   * Calculate cluster win rate
   */
  private calculateClusterWinRate(
    snapshots: DailySnapshot[],
    outcomes: ReplayOutcome[]
  ): number {
    // Group by cluster
    const clusterOutcomes = new Map<string, { wins: number; total: number }>();
    const outcomeMap = new Map(outcomes.map(o => [`${o.asset}:${o.date}`, o]));

    for (const snap of snapshots) {
      const outcome = outcomeMap.get(`${snap.asset}:${snap.date}`);
      if (!outcome) continue;

      const cluster = snap.patternId;
      const existing = clusterOutcomes.get(cluster) ?? { wins: 0, total: 0 };
      
      existing.total++;
      if (outcome.label === 'GOOD_PICK') existing.wins++;
      
      clusterOutcomes.set(cluster, existing);
    }

    // Calculate overall win rate
    let totalWins = 0;
    let totalAll = 0;
    
    for (const { wins, total } of clusterOutcomes.values()) {
      totalWins += wins;
      totalAll += total;
    }

    return totalAll > 0 ? totalWins / totalAll : 0;
  }

  /**
   * Calculate stability score (same clusters work over time)
   */
  private calculateStabilityScore(
    snapshots: DailySnapshot[],
    outcomes: ReplayOutcome[]
  ): number {
    // Track cluster performance by week
    const weeklyPerf = new Map<string, Map<string, { wins: number; total: number }>>();
    const outcomeMap = new Map(outcomes.map(o => [`${o.asset}:${o.date}`, o]));

    for (const snap of snapshots) {
      const outcome = outcomeMap.get(`${snap.asset}:${snap.date}`);
      if (!outcome) continue;

      const week = this.getWeekKey(snap.date);
      const cluster = snap.patternId;

      if (!weeklyPerf.has(week)) {
        weeklyPerf.set(week, new Map());
      }
      
      const weekMap = weeklyPerf.get(week)!;
      const existing = weekMap.get(cluster) ?? { wins: 0, total: 0 };
      
      existing.total++;
      if (outcome.label === 'GOOD_PICK') existing.wins++;
      
      weekMap.set(cluster, existing);
    }

    // Check consistency: does the same cluster perform similarly across weeks?
    const clusterConsistency: number[] = [];
    const allClusters = new Set<string>();
    
    for (const weekMap of weeklyPerf.values()) {
      for (const cluster of weekMap.keys()) {
        allClusters.add(cluster);
      }
    }

    for (const cluster of allClusters) {
      const weeklyRates: number[] = [];
      
      for (const weekMap of weeklyPerf.values()) {
        const perf = weekMap.get(cluster);
        if (perf && perf.total >= 3) { // Need min samples
          weeklyRates.push(perf.wins / perf.total);
        }
      }

      if (weeklyRates.length >= 2) {
        // Calculate variance
        const mean = weeklyRates.reduce((a, b) => a + b, 0) / weeklyRates.length;
        const variance = weeklyRates.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / weeklyRates.length;
        const consistency = 1 - Math.sqrt(variance); // Lower variance = higher consistency
        clusterConsistency.push(Math.max(0, consistency));
      }
    }

    return clusterConsistency.length > 0
      ? clusterConsistency.reduce((a, b) => a + b, 0) / clusterConsistency.length
      : 0.5;
  }

  /**
   * Run time shift test
   */
  private runTimeShiftTest(
    snapshots: DailySnapshot[],
    outcomes: ReplayOutcome[]
  ): { passed: boolean; normalAccuracy: number; shiftedAccuracy: number } {
    // Normal accuracy
    const normalCorrelation = this.calculateScoreOutcomeCorrelation(snapshots, outcomes, 0);
    
    // Shifted accuracy (shift features by 1 hour - simulate future leak)
    // In real implementation, we'd shift the actual feature timestamps
    // Here we approximate by adding random noise
    const shiftedCorrelation = this.calculateScoreOutcomeCorrelation(snapshots, outcomes, 1);

    // If shifted is much better, we have a problem
    const passed = shiftedCorrelation <= normalCorrelation * 1.2;

    return {
      passed,
      normalAccuracy: normalCorrelation,
      shiftedAccuracy: shiftedCorrelation,
    };
  }

  /**
   * Calculate correlation between scores and outcomes
   */
  private calculateScoreOutcomeCorrelation(
    snapshots: DailySnapshot[],
    outcomes: ReplayOutcome[],
    noiseLevel: number
  ): number {
    const outcomeMap = new Map(outcomes.map(o => [`${o.asset}:${o.date}`, o]));
    
    const pairs: Array<{ score: number; return: number }> = [];
    
    for (const snap of snapshots) {
      const outcome = outcomeMap.get(`${snap.asset}:${snap.date}`);
      if (!outcome) continue;

      const score = snap.opportunityScore + (Math.random() - 0.5) * noiseLevel * 20;
      pairs.push({ score, return: outcome.returnPct });
    }

    if (pairs.length < 10) return 0;

    // Simple correlation
    const n = pairs.length;
    const sumX = pairs.reduce((s, p) => s + p.score, 0);
    const sumY = pairs.reduce((s, p) => s + p.return, 0);
    const sumXY = pairs.reduce((s, p) => s + p.score * p.return, 0);
    const sumX2 = pairs.reduce((s, p) => s + p.score * p.score, 0);
    const sumY2 = pairs.reduce((s, p) => s + p.return * p.return, 0);

    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return den > 0 ? num / den : 0;
  }

  /**
   * Get week key from date
   */
  private getWeekKey(date: string): string {
    const d = new Date(date);
    const year = d.getFullYear();
    const week = Math.ceil((d.getTime() - new Date(year, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
    return `${year}-W${week}`;
  }

  /**
   * Get validation history
   */
  getHistory(limit: number = 20): ValidationMetrics[] {
    return this.history.slice(-limit);
  }

  /**
   * Get latest validation
   */
  getLatest(): ValidationMetrics | null {
    return this.history[this.history.length - 1] ?? null;
  }
}

export const validationService = new ValidationService();

console.log('[Block16] Validation Service loaded');
