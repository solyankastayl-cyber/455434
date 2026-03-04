/**
 * Rankings V2 Bucket Logic
 * 
 * Derives BUY/WATCH/SELL/NEUTRAL from rankScore + gates
 */
import type { RankBucket } from './rankings_v2.types.js';

export interface BucketInput {
  rankScore: number;
  risk: number;
  coverage: number;
  penaltyRate: number;
}

export interface BucketResult {
  bucket: RankBucket;
  reason: string;
}

/**
 * Bucket Thresholds:
 * 
 * BUY:     rankScore ≥ 70, risk ≤ 45, coverage ≥ 60, penaltyRate < 0.40
 * WATCH:   rankScore 40-69, risk ≤ 70, coverage ≥ 25
 * SELL:    rankScore < 40 OR penaltyRate > 0.40 OR risk ≥ 80
 * NEUTRAL: fallback (engine gating / data collection)
 */
export function computeBucketV2(input: BucketInput): BucketResult {
  const { rankScore, risk, coverage, penaltyRate } = input;

  // Hard safety checks (force SELL)
  if (penaltyRate > 0.40) {
    return { bucket: 'SELL', reason: 'High penalty rate (>40%)' };
  }
  if (risk >= 80) {
    return { bucket: 'SELL', reason: 'Extreme risk (≥80)' };
  }

  // BUY gates (all must pass)
  if (rankScore >= 70 && risk <= 45 && coverage >= 60) {
    return { bucket: 'BUY', reason: 'RankScore+Gates passed' };
  }

  // WATCH zone
  if (rankScore >= 40 && risk <= 70 && coverage >= 25) {
    return { bucket: 'WATCH', reason: 'Monitoring zone' };
  }

  // Low score
  if (rankScore < 40) {
    return { bucket: 'SELL', reason: 'Low rankScore (<40)' };
  }

  // Coverage too low for anything
  if (coverage < 25) {
    return { bucket: 'NEUTRAL', reason: 'Insufficient coverage' };
  }

  // Fallback
  return { bucket: 'NEUTRAL', reason: 'Engine gating / data collection' };
}
