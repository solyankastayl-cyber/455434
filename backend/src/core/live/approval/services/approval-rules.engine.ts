/**
 * Approval Rules Engine
 * 
 * Evaluates all rules against a window and calculates final score.
 * Pure function - no side effects, no Date.now(), no random().
 * 
 * score = 100 - sum(penalties)
 * >= 80 → APPROVED
 * 50-79 → QUARANTINED
 * < 50 → REJECTED
 */
import type { 
  RuleContext, 
  ApprovalResult, 
  ApprovalStatus,
  RulePenalty,
  WindowData,
} from '../approval.types.js';
import { APPROVAL_THRESHOLDS } from '../approval.types.js';

import { evaluateContinuityRule } from '../rules/continuity.rule.js';
import { evaluateVolumeSanityRule } from '../rules/volume_sanity.rule.js';
import { evaluateDuplicationRule } from '../rules/duplication.rule.js';
import { evaluateAnomalySpikeRule } from '../rules/anomaly_spike.rule.js';
import { evaluateActorCoverageRule } from '../rules/actor_coverage.rule.js';

// ==================== RULE REGISTRY ====================

type RuleEvaluator = (context: RuleContext) => RulePenalty | null;

const RULES: RuleEvaluator[] = [
  evaluateContinuityRule,
  evaluateVolumeSanityRule,
  evaluateDuplicationRule,
  evaluateAnomalySpikeRule,
  evaluateActorCoverageRule,
];

// ==================== SCORE CALCULATION ====================

/**
 * Calculate status from score
 */
function calculateStatus(score: number): ApprovalStatus {
  if (score >= APPROVAL_THRESHOLDS.APPROVED_MIN_SCORE) {
    return 'APPROVED';
  }
  if (score >= APPROVAL_THRESHOLDS.QUARANTINED_MIN_SCORE) {
    return 'QUARANTINED';
  }
  return 'REJECTED';
}

// ==================== MAIN EVALUATION ====================

/**
 * Evaluate a window against all rules
 * 
 * @param currentWindow - The window to evaluate
 * @param previousWindow - The previous window (optional, for continuity checks)
 * @returns ApprovalResult with status, score, and details
 */
export function evaluateWindow(
  currentWindow: WindowData,
  previousWindow?: WindowData
): ApprovalResult {
  const context: RuleContext = {
    currentWindow,
    previousWindow,
  };
  
  // Collect all penalties
  const penalties: RulePenalty[] = [];
  
  for (const rule of RULES) {
    const penalty = rule(context);
    if (penalty) {
      penalties.push(penalty);
    }
  }
  
  // Calculate score
  const totalPenalty = penalties.reduce((sum, p) => sum + p.penalty, 0);
  const score = Math.max(0, 100 - totalPenalty);
  
  // Determine status
  const status = calculateStatus(score);
  
  // Extract failed rule names
  const failedRules = penalties.map(p => p.rule);
  
  return {
    status,
    score,
    failedRules,
    penalties,
  };
}

/**
 * Evaluate multiple windows in batch
 */
export function evaluateWindowBatch(
  windows: WindowData[]
): Array<{ window: WindowData; result: ApprovalResult }> {
  const results: Array<{ window: WindowData; result: ApprovalResult }> = [];
  
  // Sort by windowStart for proper continuity checking
  const sorted = [...windows].sort(
    (a, b) => a.windowStart.getTime() - b.windowStart.getTime()
  );
  
  for (let i = 0; i < sorted.length; i++) {
    const currentWindow = sorted[i];
    const previousWindow = i > 0 ? sorted[i - 1] : undefined;
    
    const result = evaluateWindow(currentWindow, previousWindow);
    results.push({ window: currentWindow, result });
  }
  
  return results;
}
