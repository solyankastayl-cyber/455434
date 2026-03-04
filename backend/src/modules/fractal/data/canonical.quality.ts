/**
 * Canonical Quality Service - BLOCK 8
 * 
 * Validates historical candles and assigns quality scores.
 * Foundation for ML trust-level.
 * 
 * Checks:
 * - Sanity (OHLC relationships)
 * - Extreme wick ratio
 * - Daily volatility spike
 * - Gap jump detection
 * - Volume anomaly
 */

export interface QualityResult {
  sanity_ok: boolean;
  flags: string[];
  qualityScore: number;
}

export interface CandleOhlcv {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export class CanonicalQualityService {
  /**
   * Evaluate quality of a single candle
   */
  evaluate(
    ohlcv: CandleOhlcv,
    prevOhlcv: CandleOhlcv | null,
    volumeMean30: number
  ): QualityResult {
    const { o, h, l, c, v } = ohlcv;

    const flags: string[] = [];

    // 1️⃣ Sanity Checks
    if (h < Math.max(o, c) || l > Math.min(o, c) || h < l || v < 0) {
      flags.push('SANITY_FAIL');
      return { sanity_ok: false, flags, qualityScore: 0 };
    }

    // 2️⃣ Extreme Wick Ratio
    const body = Math.abs(c - o);
    const upperWick = h - Math.max(o, c);
    const lowerWick = Math.min(o, c) - l;
    const wickRatio = (upperWick + lowerWick) / (body + 1e-9);
    
    if (wickRatio > 10) {
      flags.push('EXTREME_WICK');
    }

    // 3️⃣ Daily Volatility Spike (>30%)
    const range = (h - l) / c;
    if (range > 0.30) {
      flags.push('VOLATILITY_SPIKE');
    }

    // 4️⃣ Gap Jump Detection (>25% overnight gap)
    if (prevOhlcv) {
      const gap = Math.abs(o / prevOhlcv.c - 1);
      if (gap > 0.25) {
        flags.push('GAP_JUMP');
      }
    }

    // 5️⃣ Volume Anomaly (>10x 30d mean)
    if (volumeMean30 > 0 && v > volumeMean30 * 10) {
      flags.push('VOLUME_ANOMALY');
    }

    // Calculate quality score
    let score = 1.0;

    for (const f of flags) {
      if (f === 'EXTREME_WICK') score -= 0.15;
      if (f === 'VOLATILITY_SPIKE') score -= 0.20;
      if (f === 'GAP_JUMP') score -= 0.20;
      if (f === 'VOLUME_ANOMALY') score -= 0.10;
    }

    score = Math.max(0, score);

    return {
      sanity_ok: true,
      flags,
      qualityScore: Math.round(score * 100) / 100
    };
  }

  /**
   * Calculate rolling 30-day volume mean
   */
  calculateVolumeMean(volumes: number[], currentIdx: number, windowSize: number = 30): number {
    const start = Math.max(0, currentIdx - windowSize);
    const slice = volumes.slice(start, currentIdx);
    
    if (slice.length === 0) return 0;
    
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  }
}
