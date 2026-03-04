/**
 * Forward Statistics Calculator
 * Aggregates outcomes into statistical distributions
 */

import { ForwardOutcome, ForwardStats, FractalConfidence } from '../contracts/fractal.contracts.js';

export interface Outcome {
  ret: number;        // forward return
  maxDD: number;      // negative number (e.g. -0.18)
}

export class ForwardStatsCalculator {
  /**
   * Calculate aggregated forward statistics from outcomes
   */
  calculate(outcomes: ForwardOutcome[], horizonDays: number): ForwardStats {
    if (outcomes.length === 0) {
      return this.emptyStats(horizonDays);
    }

    const returns = outcomes.map(o => o.returnPct);
    const drawdowns = outcomes.map(o => o.maxDrawdownPct);

    return {
      horizonDays,
      return: {
        p10: this.percentile(returns, 10),
        p50: this.percentile(returns, 50),
        p90: this.percentile(returns, 90),
        mean: this.mean(returns)
      },
      maxDrawdown: {
        p10: this.percentile(drawdowns, 10),
        p50: this.percentile(drawdowns, 50),
        p90: this.percentile(drawdowns, 90)
      }
    };
  }

  /**
   * Compute outcomes from closes array
   */
  computeOutcomes(
    closes: number[],
    matchEndIdx: number,
    horizonDays: number
  ): Outcome | null {
    const start = matchEndIdx;
    const end = matchEndIdx + horizonDays;

    if (end >= closes.length) return null;

    const entry = closes[start];
    const exit = closes[end];

    const ret = (exit / entry) - 1;

    // Max drawdown inside (start..end)
    let peak = entry;
    let maxDD = 0;

    for (let i = start; i <= end; i++) {
      const price = closes[i];
      if (price > peak) peak = price;
      const dd = (price / peak) - 1; // <= 0
      if (dd < maxDD) maxDD = dd;
    }

    return { ret, maxDD };
  }

  /**
   * Aggregate outcomes
   */
  aggregate(outcomes: Outcome[]) {
    const rets = outcomes.map(o => o.ret).sort((a, b) => a - b);
    const dds = outcomes.map(o => o.maxDD).sort((a, b) => a - b);

    const mean = (arr: number[]) =>
      arr.reduce((s, x) => s + x, 0) / Math.max(1, arr.length);

    return {
      sampleSize: outcomes.length,
      return: {
        p10: this.percentile(rets, 10),
        p50: this.percentile(rets, 50),
        p90: this.percentile(rets, 90),
        mean: mean(rets)
      },
      maxDrawdown: {
        p10: this.percentile(dds, 10),
        p50: this.percentile(dds, 50),
        p90: this.percentile(dds, 90),
        mean: mean(dds)
      }
    };
  }

  /**
   * Calculate confidence based on sample size and dispersion
   */
  calculateConfidence(outcomes: ForwardOutcome[]): FractalConfidence {
    if (outcomes.length === 0) {
      return { sampleSize: 0, stabilityScore: 0 };
    }

    const returns = outcomes.map(o => o.returnPct);
    const std = this.standardDeviation(returns);
    
    // Higher sample size = more confidence
    // Lower dispersion = more stability
    const sampleFactor = Math.min(outcomes.length / 25, 1); // max at 25 samples
    const stabilityFactor = Math.max(0, 1 - std * 2); // penalize high std

    const stabilityScore = (sampleFactor * 0.6 + stabilityFactor * 0.4);

    return {
      sampleSize: outcomes.length,
      stabilityScore: Math.round(stabilityScore * 100) / 100
    };
  }

  // Math Utilities
  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) return sorted[lower];
    
    const fraction = index - lower;
    return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private standardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    const avg = this.mean(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private emptyStats(horizonDays: number): ForwardStats {
    return {
      horizonDays,
      return: { p10: 0, p50: 0, p90: 0, mean: 0 },
      maxDrawdown: { p10: 0, p50: 0, p90: 0 }
    };
  }
}
