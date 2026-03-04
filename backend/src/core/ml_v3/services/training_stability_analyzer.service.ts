/**
 * Training Stability Analyzer - P1.1
 * 
 * Analyzes variance and stability of multi-seed training runs
 */
import type { StabilityMetrics, StabilityStats, StabilityVerdict } from '../types/training_stability.types.js';

export class TrainingStabilityAnalyzer {
  // FROZEN THRESHOLDS (P1.1)
  private readonly MIN_RUNS = 3;
  private readonly STABLE_STD_F1_THRESHOLD = 0.02;    // std(F1) <= 2%
  private readonly STABLE_CV_F1_THRESHOLD = 0.03;     // cv(F1) <= 3%

  /**
   * Compute statistics from metrics
   */
  compute(metrics: StabilityMetrics[]): StabilityStats {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const std = (xs: number[]) => {
      const m = mean(xs);
      return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
    };

    const f1s = metrics.map(m => m.f1);
    const accs = metrics.map(m => m.accuracy);

    const meanF1 = mean(f1s);
    const stdF1 = std(f1s);
    const meanAcc = mean(accs);
    const stdAcc = std(accs);

    const cvF1 = stdF1 / Math.max(meanF1, 1e-9);  // Avoid division by zero
    const cvAcc = stdAcc / Math.max(meanAcc, 1e-9);

    return {
      mean: { accuracy: meanAcc, f1: meanF1 },
      std: { accuracy: stdAcc, f1: stdF1 },
      cv: { accuracy: cvAcc, f1: cvF1 },
    };
  }

  /**
   * Determine stability verdict
   */
  verdict(metrics: StabilityMetrics[]): { verdict: StabilityVerdict; reasons: string[] } {
    if (metrics.length < this.MIN_RUNS) {
      return {
        verdict: 'INCONCLUSIVE',
        reasons: [`NOT_ENOUGH_RUNS (${metrics.length} < ${this.MIN_RUNS})`],
      };
    }

    const stats = this.compute(metrics);
    const reasons: string[] = [];

    // Check F1 standard deviation
    if (stats.std.f1 <= this.STABLE_STD_F1_THRESHOLD) {
      reasons.push(`LOW_STD_F1 (${(stats.std.f1 * 100).toFixed(2)}%)`);
    } else {
      reasons.push(`HIGH_STD_F1 (${(stats.std.f1 * 100).toFixed(2)}%)`);
    }

    // Check F1 coefficient of variation
    if (stats.cv.f1 <= this.STABLE_CV_F1_THRESHOLD) {
      reasons.push(`LOW_CV_F1 (${(stats.cv.f1 * 100).toFixed(2)}%)`);
    } else {
      reasons.push(`HIGH_CV_F1 (${(stats.cv.f1 * 100).toFixed(2)}%)`);
    }

    // Verdict: Both thresholds must be met for STABLE
    const stable = stats.std.f1 <= this.STABLE_STD_F1_THRESHOLD &&
                   stats.cv.f1 <= this.STABLE_CV_F1_THRESHOLD;

    return {
      verdict: stable ? 'STABLE' : 'UNSTABLE',
      reasons,
    };
  }

  /**
   * Get detailed analysis report
   */
  analyze(metrics: StabilityMetrics[]): {
    stats: StabilityStats;
    verdict: StabilityVerdict;
    reasons: string[];
    summary: string;
  } {
    const stats = this.compute(metrics);
    const { verdict, reasons } = this.verdict(metrics);

    let summary = '';
    if (verdict === 'STABLE') {
      summary = `Model is STABLE across ${metrics.length} seeds (F1 std=${(stats.std.f1 * 100).toFixed(2)}%, cv=${(stats.cv.f1 * 100).toFixed(2)}%)`;
    } else if (verdict === 'UNSTABLE') {
      summary = `Model is UNSTABLE across ${metrics.length} seeds (F1 std=${(stats.std.f1 * 100).toFixed(2)}%, cv=${(stats.cv.f1 * 100).toFixed(2)}%)`;
    } else {
      summary = `Insufficient data for stability analysis (${metrics.length} runs < ${this.MIN_RUNS})`;
    }

    return { stats, verdict, reasons, summary };
  }
}

export default TrainingStabilityAnalyzer;
