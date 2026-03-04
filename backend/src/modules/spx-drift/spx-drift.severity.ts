/**
 * SPX DRIFT — Severity & Confidence
 * 
 * BLOCK B6.3 — Severity ladder computation
 */

import type { DriftConfidence, DriftDelta, DriftSeverity, PerfMetrics } from './spx-drift.types.js';

export function computeConfidence(liveSamples: number): DriftConfidence {
  if (liveSamples >= 90) return 'HIGH';
  if (liveSamples >= 30) return 'MEDIUM';
  return 'LOW';
}

/**
 * Compute severity with special handling for zero LIVE samples
 * 
 * When LIVE samples = 0, comparison is statistically invalid → CRITICAL
 * (but with LOW confidence caveat)
 */
export function computeSeverityWithLive(
  delta: DriftDelta, 
  liveSamples: number
): DriftSeverity {
  // Special case: no LIVE data makes drift comparison invalid
  // Mark as CRITICAL to signal drift cannot be properly assessed
  if (liveSamples === 0) {
    return 'CRITICAL';
  }
  
  const absHit = Math.abs(delta.hitRate);
  const absSharpe = Math.abs(delta.sharpe);
  const absExpectancy = Math.abs(delta.expectancy);
  
  // CRITICAL thresholds
  if (absHit >= 8 || delta.sharpe <= -0.40 || delta.expectancy <= -0.010) {
    return 'CRITICAL';
  }
  
  // WARN thresholds
  if (absHit >= 5 || delta.sharpe <= -0.25 || delta.expectancy <= -0.006) {
    return 'WARN';
  }
  
  // WATCH thresholds
  if (absHit >= 2 || delta.sharpe <= -0.10 || delta.expectancy <= -0.003) {
    return 'WATCH';
  }
  
  return 'OK';
}

// Keep old function for backwards compatibility
export function computeSeverity(delta: DriftDelta): DriftSeverity {
  const absHit = Math.abs(delta.hitRate);
  
  if (absHit >= 8) return 'CRITICAL';
  if (absHit >= 5) return 'WARN';
  if (absHit >= 2) return 'WATCH';
  return 'OK';
}

export function buildNotes(
  live: PerfMetrics, 
  vintage: PerfMetrics, 
  confidence: DriftConfidence, 
  severity: DriftSeverity
): string[] {
  const notes: string[] = [];

  if (confidence === 'LOW') {
    notes.push('LOW_CONFIDENCE: insufficient LIVE samples for meaningful drift judgement.');
  }
  
  if (live.samples < 15) {
    notes.push('LIVE samples < 15: drift signal mostly informational.');
  }
  
  if (vintage.samples < 200) {
    notes.push('Vintage samples < 200: baseline may be noisy.');
  }

  if (severity === 'CRITICAL') {
    notes.push('CRITICAL drift: recommend lock APPLY and investigate data/market regime mismatch.');
  }
  
  if (severity === 'WARN') {
    notes.push('WARN drift: monitor closely, consider reducing reliance on SPX policy tuning.');
  }
  
  if (severity === 'WATCH') {
    notes.push('WATCH drift: early signal; continue accumulating LIVE outcomes.');
  }

  if (!Number.isFinite(live.sharpe) || !Number.isFinite(vintage.sharpe)) {
    notes.push('Sharpe non-finite: check attribution window and metric computation.');
  }

  return notes;
}
