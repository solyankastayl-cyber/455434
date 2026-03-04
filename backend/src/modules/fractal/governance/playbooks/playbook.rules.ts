/**
 * BLOCK 48.2 — Playbook Rules
 * Individual rules as pure functions
 */

import {
  PlaybookContext,
  PlaybookDecision,
  PlaybookAction,
  PlaybookType,
  PlaybookSeverity,
} from './playbook.types.js';

const now = () => Date.now();

// ═══════════════════════════════════════════════════════════════
// HELPER: Create decision
// ═══════════════════════════════════════════════════════════════

function createDecision(
  type: PlaybookType,
  severity: PlaybookSeverity,
  rationale: string[],
  actions: PlaybookAction[],
  risks: string[] = [],
  alternatives: string[] = [],
  requiresConfirmation: boolean = true
): PlaybookDecision {
  return {
    type,
    severity,
    rationale,
    recommendedActions: actions,
    risks,
    alternatives,
    requiresConfirmation,
    timestamp: now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// RULE 1: FREEZE_ONLY (highest priority)
// ═══════════════════════════════════════════════════════════════

export function ruleFreezeOnly(ctx: PlaybookContext): PlaybookDecision | null {
  // Triggers:
  // - catastrophicTriggered
  // - reliability CRITICAL
  // - calibration CRITICAL
  // - degeneration >= 0.75
  
  const reasons: string[] = [];
  
  if (ctx.catastrophicTriggered) {
    reasons.push('Catastrophic guard triggered');
  }
  
  if (ctx.reliability.badge === 'CRITICAL') {
    reasons.push('Reliability CRITICAL');
  }
  
  if (ctx.calibration.badge === 'CRITICAL') {
    reasons.push('Calibration CRITICAL');
  }
  
  if (ctx.degenerationScore >= 0.75) {
    reasons.push(`Degeneration score ${(ctx.degenerationScore * 100).toFixed(0)}% (>= 75%)`);
  }
  
  if (reasons.length === 0) return null;
  
  return createDecision(
    'FREEZE_ONLY',
    'CRITICAL',
    reasons,
    [
      { type: 'SET_MODE', payload: { mode: 'FROZEN_ONLY' }, description: 'Switch to FROZEN_ONLY mode' },
      { type: 'FREEZE_VERSION', description: 'Lock current preset version' },
      { type: 'RAISE_CONFIDENCE_THRESHOLD', payload: { add: 0.15 }, description: 'Raise confidence threshold by +15%' },
    ],
    [
      'System will be locked for minimum 30 days',
      'No configuration changes allowed',
      'May miss trading opportunities',
    ],
    [
      'Manual investigation before freeze',
      'PROTECTION_MODE first if uncertain',
    ],
    true
  );
}

// ═══════════════════════════════════════════════════════════════
// RULE 2: PROTECTION_ESCALATION
// ═══════════════════════════════════════════════════════════════

export function ruleProtectionEscalation(ctx: PlaybookContext): PlaybookDecision | null {
  // Triggers:
  // - health ALERT
  // - tail risk P95 > 0.45
  // - degeneration 0.55-0.75
  // - reliability drop > 12% in 7d
  
  const reasons: string[] = [];
  
  if (ctx.health === 'ALERT') {
    reasons.push('Health level ALERT');
  }
  
  if (ctx.tailRisk.p95MaxDD > 0.45) {
    reasons.push(`Tail risk P95 DD ${(ctx.tailRisk.p95MaxDD * 100).toFixed(0)}% (> 45%)`);
  }
  
  if (ctx.degenerationScore >= 0.55 && ctx.degenerationScore < 0.75) {
    reasons.push(`Degeneration score ${(ctx.degenerationScore * 100).toFixed(0)}% (55-75%)`);
  }
  
  if (ctx.reliability.delta7d <= -0.12) {
    reasons.push(`Reliability dropped ${(ctx.reliability.delta7d * 100).toFixed(0)}% in 7 days`);
  }
  
  if (reasons.length === 0) return null;
  
  return createDecision(
    'PROTECTION_ESCALATION',
    'HIGH',
    reasons,
    [
      { type: 'SET_MODE', payload: { mode: 'PROTECTION_MODE' }, description: 'Switch to PROTECTION_MODE' },
      { type: 'ENABLE_PROTECTION', description: 'Enable protective overrides' },
      { type: 'RAISE_CONFIDENCE_THRESHOLD', payload: { add: 0.10 }, description: 'Raise confidence threshold by +10%' },
      { type: 'LIMIT_EXPOSURE', payload: { multiplier: 0.6 }, description: 'Limit exposure to 60%' },
    ],
    [
      'Reduced trading activity for 14+ days',
      'Lower potential returns during protection',
    ],
    [
      'INVESTIGATION if causes unclear',
      'FREEZE_ONLY if situation worsens',
    ],
    true
  );
}

// ═══════════════════════════════════════════════════════════════
// RULE 3: RECALIBRATION
// ═══════════════════════════════════════════════════════════════

export function ruleRecalibration(ctx: PlaybookContext): PlaybookDecision | null {
  // Triggers:
  // - calibration DEGRADED or CRITICAL
  // - ECE > 0.15
  
  if (ctx.calibration.badge !== 'DEGRADED' && ctx.calibration.badge !== 'CRITICAL') {
    return null;
  }
  
  const severity: PlaybookSeverity = ctx.calibration.badge === 'CRITICAL' ? 'HIGH' : 'MEDIUM';
  
  return createDecision(
    'RECALIBRATION',
    severity,
    [
      `Calibration badge: ${ctx.calibration.badge}`,
      `ECE: ${(ctx.calibration.ece * 100).toFixed(1)}%`,
    ],
    [
      { type: 'RESET_CALIBRATION', description: 'Reset calibration buckets' },
      { type: 'RAISE_CONFIDENCE_THRESHOLD', payload: { add: 0.05 }, description: 'Temporarily raise confidence threshold by +5%' },
    ],
    [
      'Calibration reset may take time to stabilize',
      'Temporarily reduced confidence accuracy',
    ],
    [
      'Continue monitoring without reset',
      'Wait for more data before recalibrating',
    ],
    true
  );
}

// ═══════════════════════════════════════════════════════════════
// RULE 4: INVESTIGATION
// ═══════════════════════════════════════════════════════════════

export function ruleInvestigation(ctx: PlaybookContext): PlaybookDecision | null {
  // Triggers:
  // - WATCH state > 7 days
  // - Conflicting signals (sharpe falling but drift OK)
  // - Degeneration 0.3-0.55
  
  const reasons: string[] = [];
  
  if (ctx.health === 'WATCH' && ctx.healthWatchDays > 7) {
    reasons.push(`Health WATCH for ${ctx.healthWatchDays} days (> 7)`);
  }
  
  if (ctx.perfWindows.sharpe60d < 0.3 && ctx.drift.badge === 'OK') {
    reasons.push('Sharpe declining but drift normal - investigation needed');
  }
  
  if (ctx.degenerationScore >= 0.3 && ctx.degenerationScore < 0.55) {
    reasons.push(`Moderate degeneration ${(ctx.degenerationScore * 100).toFixed(0)}% - needs analysis`);
  }
  
  if (reasons.length === 0) return null;
  
  return createDecision(
    'INVESTIGATION',
    'LOW',
    reasons,
    [
      { type: 'RUN_VALIDATION', description: 'Run Rolling Validation harness' },
      { type: 'RUN_MONTE_CARLO', description: 'Run Monte Carlo analysis' },
      { type: 'COMPARE_SHADOW', description: 'Compare Active vs Shadow performance' },
      { type: 'NO_ACTION', description: 'Continue monitoring without mode change' },
    ],
    [
      'Issue may escalate if not addressed',
      'Manual review time required',
    ],
    [
      'PROTECTION_ESCALATION if uncertain',
      'Wait and continue monitoring',
    ],
    false  // No confirmation needed for investigation
  );
}

// ═══════════════════════════════════════════════════════════════
// RULE 5: RECOVERY
// ═══════════════════════════════════════════════════════════════

export function ruleRecovery(ctx: PlaybookContext): PlaybookDecision | null {
  // Triggers:
  // - consecutiveHealthyDays >= 30
  // - Currently NOT in NORMAL mode
  // - No critical issues
  
  if (ctx.governanceMode === 'NORMAL') {
    return null;
  }
  
  if (ctx.consecutiveHealthyDays < 30) {
    return null;
  }
  
  // Check no critical issues
  if (ctx.catastrophicTriggered) return null;
  if (ctx.reliability.badge === 'CRITICAL') return null;
  if (ctx.calibration.badge === 'CRITICAL') return null;
  
  return createDecision(
    'RECOVERY',
    'LOW',
    [
      `System healthy for ${ctx.consecutiveHealthyDays} consecutive days`,
      `Current mode: ${ctx.governanceMode}`,
      'No critical issues detected',
    ],
    [
      { type: 'SET_MODE', payload: { mode: 'NORMAL' }, description: 'Return to NORMAL mode' },
    ],
    [
      'Premature exit could expose to risks',
      'Ensure all metrics stable before recovery',
    ],
    [
      'Continue in current mode for more stability',
      'Gradual transition through PROTECTION_MODE first',
    ],
    true
  );
}
