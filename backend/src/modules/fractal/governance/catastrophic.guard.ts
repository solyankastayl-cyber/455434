/**
 * BLOCK 47.2-47.4 — Catastrophic Guard
 * Hard triggers + mode recommendation + latch logic
 */

import {
  GuardContext,
  GuardDecision,
  GovernanceMode,
  GuardReasonCode,
  LatchConfig,
  DEFAULT_LATCH_CONFIG,
  DEFAULT_GUARD_THRESHOLDS,
} from './guard.types.js';
import { calculateDegeneration } from './degeneration.monitor.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// CATASTROPHIC TRIGGERS (immediate)
// ═══════════════════════════════════════════════════════════════

interface CatastrophicResult {
  triggered: boolean;
  reasons: GuardReasonCode[];
}

function checkCatastrophicTriggers(ctx: GuardContext): CatastrophicResult {
  const reasons: GuardReasonCode[] = [];
  let triggered = false;
  
  // Health CRITICAL
  if (ctx.health === 'CRITICAL') {
    triggered = true;
    reasons.push('HEALTH_CRITICAL');
  }
  
  // Reliability CRITICAL
  if (ctx.reliability.badge === 'CRITICAL') {
    triggered = true;
    reasons.push('RELIABILITY_CRITICAL');
  }
  
  // Calibration CRITICAL
  if (ctx.calibration.badge === 'CRITICAL') {
    triggered = true;
    reasons.push('CALIBRATION_CRITICAL');
  }
  
  // Drift >= critical
  if (ctx.drift.score >= DEFAULT_GUARD_THRESHOLDS.driftCritical) {
    triggered = true;
    reasons.push('DRIFT_CRITICAL');
  }
  
  // MC P95 DD >= 0.55
  if (ctx.tailRisk.p95MaxDD >= DEFAULT_GUARD_THRESHOLDS.p95MaxDDCritical) {
    triggered = true;
    reasons.push('TAIL_RISK_SEVERE');
  }
  
  // Worst DD >= 0.75
  if (ctx.tailRisk.worstDD >= DEFAULT_GUARD_THRESHOLDS.worstDDCritical) {
    triggered = true;
    reasons.push('TAIL_RISK_SEVERE');
  }
  
  return { triggered, reasons };
}

// ═══════════════════════════════════════════════════════════════
// ALERT TRIGGERS (require streak)
// ═══════════════════════════════════════════════════════════════

interface AlertResult {
  triggered: boolean;
  reasons: GuardReasonCode[];
}

function checkAlertTriggers(ctx: GuardContext): AlertResult {
  const reasons: GuardReasonCode[] = [];
  let triggered = false;
  
  // Health ALERT for 2+ days
  if (ctx.health === 'ALERT' && ctx.healthStreak >= 2) {
    triggered = true;
    reasons.push('HEALTH_ALERT_STREAK');
  }
  
  // Reliability drop >= 12% in 7 days
  if (ctx.reliability.delta7d <= DEFAULT_GUARD_THRESHOLDS.reliabilityDrop7dWarn) {
    triggered = true;
    reasons.push('RELIABILITY_DROP_STREAK');
  }
  
  // Sharpe60d < 0 AND DD60d > 0.18
  if (
    ctx.perfWindows.sharpe60d < DEFAULT_GUARD_THRESHOLDS.sharpe60dWarn &&
    ctx.perfWindows.maxDD60d > DEFAULT_GUARD_THRESHOLDS.maxDD60dWarn
  ) {
    triggered = true;
    reasons.push('PERF_WINDOW_BREAKDOWN');
  }
  
  return { triggered, reasons };
}

// ═══════════════════════════════════════════════════════════════
// LATCH CHECK
// ═══════════════════════════════════════════════════════════════

function isLatched(ctx: GuardContext): boolean {
  if (!ctx.latchUntil) return false;
  return Date.now() < ctx.latchUntil;
}

function canExitProtection(ctx: GuardContext, config: LatchConfig): boolean {
  // Must have been healthy for N days
  if (ctx.health !== 'HEALTHY' && ctx.health !== 'WATCH') {
    return false;
  }
  
  if (ctx.healthStreak < config.exitRequiredHealthyDays) {
    return false;
  }
  
  // No critical triggers
  const catastrophic = checkCatastrophicTriggers(ctx);
  if (catastrophic.triggered) {
    return false;
  }
  
  return true;
}

function calculateLatchUntil(
  mode: GovernanceMode,
  config: LatchConfig
): number | null {
  const now = Date.now();
  
  if (mode === 'PROTECTION_MODE') {
    return now + config.protectionMinDays * MS_PER_DAY;
  }
  
  if (mode === 'FROZEN_ONLY' || mode === 'HALT_TRADING') {
    return now + config.frozenMinDays * MS_PER_DAY;
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN GUARD EVALUATION
// ═══════════════════════════════════════════════════════════════

export interface GuardEvaluateOptions {
  latchConfig?: LatchConfig;
}

export function evaluateGuard(
  ctx: GuardContext,
  options: GuardEvaluateOptions = {}
): GuardDecision {
  const config = options.latchConfig || DEFAULT_LATCH_CONFIG;
  const now = Date.now();
  
  // Calculate degeneration score
  const degeneration = calculateDegeneration(ctx);
  
  // Check catastrophic triggers
  const catastrophic = checkCatastrophicTriggers(ctx);
  
  // Check alert triggers
  const alert = checkAlertTriggers(ctx);
  
  // Combine all reasons
  const allReasons = [
    ...new Set([
      ...catastrophic.reasons,
      ...alert.reasons,
      ...degeneration.reasons,
    ]),
  ];
  
  // Determine recommended mode
  let recommendedMode: GovernanceMode = 'NORMAL';
  let latchUntil: number | null = null;
  
  // Priority 1: Catastrophic → FROZEN_ONLY
  if (catastrophic.triggered) {
    recommendedMode = 'FROZEN_ONLY';
    latchUntil = calculateLatchUntil('FROZEN_ONLY', config);
  }
  // Priority 2: High degeneration → FROZEN_ONLY
  else if (degeneration.score >= DEFAULT_GUARD_THRESHOLDS.degenerationFrozen) {
    recommendedMode = 'FROZEN_ONLY';
    latchUntil = calculateLatchUntil('FROZEN_ONLY', config);
  }
  // Priority 3: Alert or moderate degeneration → PROTECTION_MODE
  else if (
    alert.triggered ||
    degeneration.score >= DEFAULT_GUARD_THRESHOLDS.degenerationProtection
  ) {
    recommendedMode = 'PROTECTION_MODE';
    latchUntil = calculateLatchUntil('PROTECTION_MODE', config);
  }
  
  // Check if currently latched
  if (isLatched(ctx)) {
    // Can only exit if conditions met
    if (
      recommendedMode === 'NORMAL' &&
      ctx.governanceMode !== 'NORMAL' &&
      canExitProtection(ctx, config)
    ) {
      // Allow exit
      latchUntil = null;
    } else {
      // Keep current mode and latch
      recommendedMode = ctx.governanceMode;
      latchUntil = ctx.latchUntil;
    }
  }
  
  // Calculate confidence based on number of confirming signals
  const confirmedCount = allReasons.length;
  const confidence = Math.min(1, 0.5 + confirmedCount * 0.1);
  
  return {
    recommendedMode,
    currentMode: ctx.governanceMode,
    reasons: allReasons,
    degenerationScore: degeneration.score,
    catastrophicTriggered: catastrophic.triggered,
    latchUntil,
    confidence,
    timestamp: now,
    wouldChange: recommendedMode !== ctx.governanceMode,
  };
}
