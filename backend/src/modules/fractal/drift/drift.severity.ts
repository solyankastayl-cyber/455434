/**
 * BLOCK 78.1 — Drift Severity Scoring
 * 
 * Deterministic rules for severity classification.
 * Thresholds are institutional-grade.
 */

import { DriftDeltas, DriftSeverity, DriftReason } from './drift.types.js';

// ═══════════════════════════════════════════════════════════════
// SEVERITY THRESHOLDS (Institutional Grade)
// ═══════════════════════════════════════════════════════════════

const THRESHOLDS = {
  // CRITICAL thresholds
  CRITICAL_HIT_RATE_PP: 7,
  CRITICAL_CALIBRATION_PP: 10,
  CRITICAL_SHARPE_DROP: -0.5,
  
  // WARN thresholds
  WARN_HIT_RATE_PP: 4,
  WARN_CALIBRATION_PP: 6,
  WARN_SHARPE_DROP: -0.35,
  
  // WATCH thresholds
  WATCH_HIT_RATE_PP: 2,
  WATCH_CALIBRATION_PP: 3,
  WATCH_SHARPE_DROP: -0.15,
  
  // Minimum samples for reliability
  MIN_LIVE_SAMPLES: 30,
  MIN_BOOTSTRAP_SAMPLES: 100,
};

// ═══════════════════════════════════════════════════════════════
// SEVERITY SCORING
// ═══════════════════════════════════════════════════════════════

export function scoreSeverity(
  deltas: DriftDeltas, 
  reasons: DriftReason[],
  sampleA: number,
  sampleB: number
): DriftSeverity {
  const abs = Math.abs;
  
  // CRITICAL conditions
  const isCritical = 
    abs(deltas.hitRatePP) >= THRESHOLDS.CRITICAL_HIT_RATE_PP ||
    abs(deltas.calibrationPP) >= THRESHOLDS.CRITICAL_CALIBRATION_PP ||
    deltas.sharpe <= THRESHOLDS.CRITICAL_SHARPE_DROP ||
    reasons.includes('TAIL_SHIFT') ||
    reasons.includes('REGIME_MISMATCH');
  
  if (isCritical) return 'CRITICAL';
  
  // WARN conditions
  const isWarn = 
    abs(deltas.hitRatePP) >= THRESHOLDS.WARN_HIT_RATE_PP ||
    abs(deltas.calibrationPP) >= THRESHOLDS.WARN_CALIBRATION_PP ||
    deltas.sharpe <= THRESHOLDS.WARN_SHARPE_DROP;
  
  if (isWarn) return 'WARN';
  
  // WATCH conditions
  const isWatch = 
    abs(deltas.hitRatePP) >= THRESHOLDS.WATCH_HIT_RATE_PP ||
    abs(deltas.calibrationPP) >= THRESHOLDS.WATCH_CALIBRATION_PP ||
    deltas.sharpe <= THRESHOLDS.WATCH_SHARPE_DROP ||
    sampleA < THRESHOLDS.MIN_LIVE_SAMPLES;
  
  if (isWatch) return 'WATCH';
  
  return 'OK';
}

// ═══════════════════════════════════════════════════════════════
// REASON DETECTION
// ═══════════════════════════════════════════════════════════════

export function detectReasons(
  deltas: DriftDeltas,
  sampleA: number,
  sampleB: number,
  statsA?: any,
  statsB?: any
): DriftReason[] {
  const reasons: DriftReason[] = [];
  const abs = Math.abs;
  
  // Calibration drift
  if (abs(deltas.calibrationPP) >= THRESHOLDS.WATCH_CALIBRATION_PP) {
    reasons.push('CALIBRATION_DRIFT');
  }
  
  // Hit rate drift
  if (abs(deltas.hitRatePP) >= THRESHOLDS.WATCH_HIT_RATE_PP) {
    reasons.push('HIT_RATE_DRIFT');
  }
  
  // Sharpe collapse
  if (deltas.sharpe <= THRESHOLDS.WARN_SHARPE_DROP) {
    reasons.push('SHARPE_COLLAPSE');
  }
  
  // Low sample warning
  if (sampleA < THRESHOLDS.MIN_LIVE_SAMPLES || sampleB < THRESHOLDS.MIN_BOOTSTRAP_SAMPLES) {
    reasons.push('LOW_SAMPLE');
  }
  
  // Tail shift detection (if maxDD data available)
  if (deltas.maxDDPP !== undefined && abs(deltas.maxDDPP) >= 15) {
    reasons.push('TAIL_SHIFT');
  }
  
  // Divergence inflation (if stats available)
  if (statsA?.avgDivergence !== undefined && statsB?.avgDivergence !== undefined) {
    const divDrift = statsA.avgDivergence - statsB.avgDivergence;
    if (divDrift > 15) {
      reasons.push('DIVERGENCE_INFLATION');
    }
  }
  
  return reasons;
}

// ═══════════════════════════════════════════════════════════════
// RECOMMENDATION LOGIC
// ═══════════════════════════════════════════════════════════════

export function determineRecommendation(
  overallSeverity: DriftSeverity,
  hasLiveSamples: boolean,
  reasons: DriftReason[]
): { recommendation: string; notes: string[]; blockedActions: string[] } {
  const notes: string[] = [];
  const blockedActions: string[] = [];
  
  if (overallSeverity === 'CRITICAL') {
    notes.push('CRITICAL drift detected - immediate investigation required');
    notes.push('Model calibration may be compromised');
    blockedActions.push('POLICY_APPLY', 'WEIGHT_TUNING', 'AUTO_CALIBRATION');
    return { recommendation: 'LOCKDOWN', notes, blockedActions };
  }
  
  if (overallSeverity === 'WARN') {
    notes.push('Significant drift between cohorts detected');
    notes.push('Review tier/regime breakdown for root cause');
    if (reasons.includes('CALIBRATION_DRIFT')) {
      blockedActions.push('AUTO_CALIBRATION');
    }
    return { recommendation: 'INVESTIGATE', notes, blockedActions };
  }
  
  if (overallSeverity === 'WATCH') {
    notes.push('Minor drift detected - monitor closely');
    if (!hasLiveSamples) {
      notes.push('Insufficient LIVE samples for reliable comparison');
    }
    return { recommendation: 'NO_ACTION', notes, blockedActions };
  }
  
  notes.push('All cohort comparisons within acceptable bounds');
  notes.push('System calibration appears stable');
  return { recommendation: 'NO_ACTION', notes, blockedActions };
}

export { THRESHOLDS };
