/**
 * BATCH 3: Shadow Verdict Logic
 * 
 * Определяет PASS/FAIL/INCONCLUSIVE на основе дельты метрик.
 */

import { SHADOW_EVAL_RULES_VERSION, SHADOW_EVAL_THRESHOLDS } from './shadow_eval.config.js';

export type ShadowVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface VerdictResult {
  status: ShadowVerdict;
  reason: string;
  rulesVersion: string;
}

/**
 * Make verdict based on comparison results
 */
export function makeVerdict(args: {
  rows: number;
  f1Delta: number;
  accuracyDelta: number;
}): VerdictResult {
  const { rows, f1Delta, accuracyDelta } = args;
  const { minRows, pass, fail } = SHADOW_EVAL_THRESHOLDS;

  // Not enough data
  if (rows < minRows) {
    return {
      status: 'INCONCLUSIVE',
      reason: `Not enough rows: ${rows} < ${minRows}`,
      rulesVersion: SHADOW_EVAL_RULES_VERSION,
    };
  }

  // FAIL fast - shadow is significantly worse
  if (f1Delta <= fail.maxF1Delta) {
    return {
      status: 'FAIL',
      reason: `F1 delta too low: ${f1Delta.toFixed(4)} <= ${fail.maxF1Delta}`,
      rulesVersion: SHADOW_EVAL_RULES_VERSION,
    };
  }
  
  if (accuracyDelta <= fail.maxAccuracyDelta) {
    return {
      status: 'FAIL',
      reason: `Accuracy delta too low: ${accuracyDelta.toFixed(4)} <= ${fail.maxAccuracyDelta}`,
      rulesVersion: SHADOW_EVAL_RULES_VERSION,
    };
  }

  // PASS - shadow is better
  if (f1Delta >= pass.minF1Delta && accuracyDelta >= pass.minAccuracyDelta) {
    return {
      status: 'PASS',
      reason: `PASS: f1Δ=${f1Delta.toFixed(4)} >= ${pass.minF1Delta}, accΔ=${accuracyDelta.toFixed(4)} >= ${pass.minAccuracyDelta}`,
      rulesVersion: SHADOW_EVAL_RULES_VERSION,
    };
  }

  // Otherwise inconclusive - needs more evaluation
  return {
    status: 'INCONCLUSIVE',
    reason: `Inconclusive: f1Δ=${f1Delta.toFixed(4)}, accΔ=${accuracyDelta.toFixed(4)} (between thresholds)`,
    rulesVersion: SHADOW_EVAL_RULES_VERSION,
  };
}
