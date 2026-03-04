/**
 * BLOCK 47.1 — Degeneration Monitor
 * Trend-based deterioration detection
 */

import {
  GuardContext,
  DegenerationResult,
  DegenerationSubscores,
  GuardReasonCode,
  DEFAULT_GUARD_THRESHOLDS,
} from './guard.types.js';

// ═══════════════════════════════════════════════════════════════
// SUBSCORE WEIGHTS
// ═══════════════════════════════════════════════════════════════

const WEIGHTS = {
  reliabilityTrend: 0.25,
  driftTrend: 0.20,
  calibrationTrend: 0.15,
  tailRiskTrend: 0.25,
  perfWindowTrend: 0.15,
};

// ═══════════════════════════════════════════════════════════════
// INDIVIDUAL SUBSCORES
// ═══════════════════════════════════════════════════════════════

/**
 * A) Reliability Trend (weight 0.25)
 * - drop7d <= -0.12 → 1.0
 * - drop7d <= -0.06 → 0.6
 * - else scale
 */
function calcReliabilityTrend(ctx: GuardContext): { score: number; reasons: GuardReasonCode[] } {
  const drop7d = ctx.reliability.delta7d;
  const reasons: GuardReasonCode[] = [];
  let score = 0;
  
  if (drop7d <= -0.12) {
    score = 1.0;
    reasons.push('RELIABILITY_DROP_STREAK');
  } else if (drop7d <= -0.06) {
    score = 0.6;
    reasons.push('RELIABILITY_DROP_STREAK');
  } else if (drop7d < 0) {
    score = Math.abs(drop7d) / 0.12;
  }
  
  if (ctx.reliability.badge === 'CRITICAL') {
    score = Math.max(score, 1.0);
    reasons.push('RELIABILITY_CRITICAL');
  }
  
  return { score: Math.min(1, score), reasons };
}

/**
 * B) Drift Trend (weight 0.20)
 * - drift >= critical → 1.0
 * - drift >= warn → 0.6
 */
function calcDriftTrend(ctx: GuardContext): { score: number; reasons: GuardReasonCode[] } {
  const drift = ctx.drift.score;
  const reasons: GuardReasonCode[] = [];
  let score = 0;
  
  if (drift >= DEFAULT_GUARD_THRESHOLDS.driftCritical) {
    score = 1.0;
    reasons.push('DRIFT_CRITICAL');
  } else if (drift >= DEFAULT_GUARD_THRESHOLDS.driftWarn) {
    score = 0.6;
    reasons.push('DRIFT_WARN');
  } else if (drift > 0) {
    score = drift / DEFAULT_GUARD_THRESHOLDS.driftWarn * 0.5;
  }
  
  return { score: Math.min(1, score), reasons };
}

/**
 * C) Calibration Trend (weight 0.15)
 * - badge DEGRADED → 0.7
 * - badge CRITICAL → 1.0
 * - plus ECE growth penalty
 */
function calcCalibrationTrend(ctx: GuardContext): { score: number; reasons: GuardReasonCode[] } {
  const reasons: GuardReasonCode[] = [];
  let score = 0;
  
  if (ctx.calibration.badge === 'CRITICAL') {
    score = 1.0;
    reasons.push('CALIBRATION_CRITICAL');
  } else if (ctx.calibration.badge === 'DEGRADED') {
    score = 0.7;
    reasons.push('CALIBRATION_DEGRADED');
  }
  
  // Add penalty for ECE growth
  if (ctx.calibration.eceDelta30d > 0.05) {
    score = Math.min(1, score + 0.2);
  }
  
  return { score, reasons };
}

/**
 * D) Tail Risk Trend (weight 0.25)
 * - mcP95DD >= 0.55 → 1.0
 * - >= 0.45 → 0.7
 * - >= 0.35 → 0.4
 * - plus widening penalty
 */
function calcTailRiskTrend(ctx: GuardContext): { score: number; reasons: GuardReasonCode[] } {
  const p95 = ctx.tailRisk.p95MaxDD;
  const reasons: GuardReasonCode[] = [];
  let score = 0;
  
  if (p95 >= DEFAULT_GUARD_THRESHOLDS.p95MaxDDCritical) {
    score = 1.0;
    reasons.push('TAIL_RISK_SEVERE');
  } else if (p95 >= DEFAULT_GUARD_THRESHOLDS.p95MaxDDWarn) {
    score = 0.7;
    reasons.push('TAIL_RISK_EXPANDED');
  } else if (p95 >= 0.35) {
    score = 0.4;
    reasons.push('TAIL_RISK_EXPANDED');
  }
  
  // Widening: P95 - median
  const widening = p95 - ctx.tailRisk.medianDD;
  if (widening > 0.15) {
    score = Math.min(1, score + 0.2);
  }
  
  // Delta 30d penalty
  if (ctx.tailRisk.p95Delta30d > 0.10) {
    score = Math.min(1, score + 0.15);
  }
  
  return { score, reasons };
}

/**
 * E) Performance Window Trend (weight 0.15)
 * - Sharpe60d < 0 AND MaxDD60d > 0.18 → 1.0
 * - one of them → 0.6
 */
function calcPerfWindowTrend(ctx: GuardContext): { score: number; reasons: GuardReasonCode[] } {
  const sharpe = ctx.perfWindows.sharpe60d;
  const maxDD = ctx.perfWindows.maxDD60d;
  const reasons: GuardReasonCode[] = [];
  let score = 0;
  
  const sharpeBad = sharpe < DEFAULT_GUARD_THRESHOLDS.sharpe60dWarn;
  const ddBad = maxDD > DEFAULT_GUARD_THRESHOLDS.maxDD60dWarn;
  
  if (sharpeBad && ddBad) {
    score = 1.0;
    reasons.push('PERF_WINDOW_BREAKDOWN');
  } else if (sharpeBad || ddBad) {
    score = 0.6;
    reasons.push('PERF_WINDOW_BREAKDOWN');
  }
  
  return { score, reasons };
}

// ═══════════════════════════════════════════════════════════════
// MAIN MONITOR FUNCTION
// ═══════════════════════════════════════════════════════════════

export function calculateDegeneration(ctx: GuardContext): DegenerationResult {
  const reliabilityResult = calcReliabilityTrend(ctx);
  const driftResult = calcDriftTrend(ctx);
  const calibrationResult = calcCalibrationTrend(ctx);
  const tailRiskResult = calcTailRiskTrend(ctx);
  const perfWindowResult = calcPerfWindowTrend(ctx);
  
  const subscores: DegenerationSubscores = {
    reliabilityTrend: reliabilityResult.score,
    driftTrend: driftResult.score,
    calibrationTrend: calibrationResult.score,
    tailRiskTrend: tailRiskResult.score,
    perfWindowTrend: perfWindowResult.score,
  };
  
  // Weighted aggregate
  const score =
    WEIGHTS.reliabilityTrend * subscores.reliabilityTrend +
    WEIGHTS.driftTrend * subscores.driftTrend +
    WEIGHTS.calibrationTrend * subscores.calibrationTrend +
    WEIGHTS.tailRiskTrend * subscores.tailRiskTrend +
    WEIGHTS.perfWindowTrend * subscores.perfWindowTrend;
  
  // Collect unique reasons
  const allReasons = [
    ...reliabilityResult.reasons,
    ...driftResult.reasons,
    ...calibrationResult.reasons,
    ...tailRiskResult.reasons,
    ...perfWindowResult.reasons,
  ];
  const uniqueReasons = [...new Set(allReasons)];
  
  return {
    score: Math.min(1, Math.max(0, score)),
    subscores,
    reasons: uniqueReasons,
  };
}
