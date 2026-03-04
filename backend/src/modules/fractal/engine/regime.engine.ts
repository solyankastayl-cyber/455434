/**
 * Regime Detection Engine - BLOCK 11
 * 
 * Classifies market regime on two dimensions:
 * - Volatility: LOW_VOL | NORMAL_VOL | HIGH_VOL
 * - Trend: UP_TREND | DOWN_TREND | SIDEWAYS
 */

export type VolatilityRegime = 'LOW_VOL' | 'NORMAL_VOL' | 'HIGH_VOL';
export type TrendRegime = 'UP_TREND' | 'DOWN_TREND' | 'SIDEWAYS';

export interface RegimeState {
  volatility: VolatilityRegime;
  trend: TrendRegime;
  volValue: number;
  trendSlope: number;
}

export class RegimeEngine {
  /**
   * Compute volatility from log returns (std dev)
   */
  computeVolatility(returns: number[]): number {
    const n = returns.length;
    if (n === 0) return 0;

    const mean = returns.reduce((s, x) => s + x, 0) / n;

    const variance = returns.reduce((s, x) => {
      const d = x - mean;
      return s + d * d;
    }, 0) / Math.max(1, n - 1);

    return Math.sqrt(variance);
  }

  /**
   * Compute trend slope via linear regression (normalized by price)
   */
  computeTrendSlope(closes: number[]): number {
    const n = closes.length;
    if (n < 2) return 0;

    const xMean = (n - 1) / 2;
    const yMean = closes.reduce((s, x) => s + x, 0) / n;

    let num = 0;
    let den = 0;

    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (closes[i] - yMean);
      den += (i - xMean) * (i - xMean);
    }

    return den === 0 ? 0 : num / den / yMean;
  }

  /**
   * Classify volatility level
   */
  classifyVol(vol: number): VolatilityRegime {
    if (vol < 0.02) return 'LOW_VOL';
    if (vol < 0.05) return 'NORMAL_VOL';
    return 'HIGH_VOL';
  }

  /**
   * Classify trend direction
   */
  classifyTrend(slope: number): TrendRegime {
    if (slope > 0.001) return 'UP_TREND';
    if (slope < -0.001) return 'DOWN_TREND';
    return 'SIDEWAYS';
  }

  /**
   * Build regime state for current market (last 30/90 days)
   */
  buildCurrentRegime(closes: number[]): RegimeState {
    // Volatility from last 30 days returns
    const returns: number[] = [];
    for (let i = closes.length - 31; i < closes.length - 1; i++) {
      if (i < 0) continue;
      returns.push(Math.log(closes[i + 1] / closes[i]));
    }

    const vol = this.computeVolatility(returns);

    // Trend from last 90 days
    const last90 = closes.slice(-90);
    const slope = this.computeTrendSlope(last90);

    return {
      volatility: this.classifyVol(vol),
      trend: this.classifyTrend(slope),
      volValue: Math.round(vol * 10000) / 10000,
      trendSlope: Math.round(slope * 100000) / 100000
    };
  }

  /**
   * Build regime state for historical period ending at endIdx
   */
  buildHistoricalRegime(closes: number[], endIdx: number): RegimeState {
    // Volatility from 30 days before endIdx
    const returns: number[] = [];
    for (let i = endIdx - 30; i < endIdx; i++) {
      if (i <= 0) continue;
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }

    const vol = this.computeVolatility(returns);

    // Trend from 90 days before endIdx
    const startIdx = Math.max(0, endIdx - 89);
    const slice = closes.slice(startIdx, endIdx + 1);
    const slope = this.computeTrendSlope(slice);

    return {
      volatility: this.classifyVol(vol),
      trend: this.classifyTrend(slope),
      volValue: Math.round(vol * 10000) / 10000,
      trendSlope: Math.round(slope * 100000) / 100000
    };
  }

  /**
   * Calculate regime match score between two regime states
   * Returns 0..1 (0.5 for trend match, 0.5 for volatility match)
   */
  matchScore(a: RegimeState, b: RegimeState): number {
    let s = 0;
    if (a.trend === b.trend) s += 0.5;
    if (a.volatility === b.volatility) s += 0.5;
    return s;
  }

  /**
   * Calculate regime multiplier from match score
   * score=0 → 0.75 (penalty -25%)
   * score=1 → 1.25 (bonus +25%)
   */
  multiplier(matchScore: number): number {
    return 0.75 + 0.5 * matchScore;
  }
}
