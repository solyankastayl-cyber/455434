/**
 * C3.2 — Decision Matrix v1
 * ==========================
 * 
 * CANONICAL DECISION RULES — LOCKED v1
 * 
 * This is DATA, not code.
 * The matrix defines what happens in each case.
 * 
 * Logic hierarchy:
 * 1. Determine alignment (ALIGNED/PARTIAL/CONFLICT)
 * 2. Apply validation multiplier
 * 3. Match rule from matrix
 * 4. Apply guards (downgrade only)
 */

import {
  MatrixRule,
  AlignmentType,
  ValidationStatus,
  FinalVerdict,
  VALIDATION_MULTIPLIERS,
  THRESHOLDS,
} from '../contracts/metaBrainV2.types.js';

// ═══════════════════════════════════════════════════════════════
// MATRIX RULES (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

/**
 * Decision Matrix Rules
 * 
 * Matching order: first match wins
 * DIR placeholder replaced with actual direction (BULLISH/BEARISH)
 */
export const DECISION_MATRIX_V1: MatrixRule[] = [
  // ─────────────────────────────────────────────────
  // ALIGNED (Sentiment == Exchange)
  // ─────────────────────────────────────────────────
  {
    id: 'ALIGNED_CONFIRMS_STRONG',
    alignment: 'ALIGNED',
    validation: 'CONFIRMS',
    output: 'STRONG_BULLISH',  // Placeholder: actual direction applied at runtime
    conditions: { minConfidence: THRESHOLDS.STRONG_CONFIDENCE },
    description: 'All layers aligned with high confidence',
  },
  {
    id: 'ALIGNED_CONFIRMS_WEAK',
    alignment: 'ALIGNED',
    validation: 'CONFIRMS',
    output: 'WEAK_BULLISH',  // Placeholder
    description: 'All layers aligned but confidence below STRONG threshold',
  },
  {
    id: 'ALIGNED_NODATA_WEAK',
    alignment: 'ALIGNED',
    validation: 'NO_DATA',
    output: 'WEAK_BULLISH',  // Placeholder - STRONG forbidden without validation
    description: 'S+E aligned but no on-chain verification - STRONG forbidden',
  },
  {
    id: 'ALIGNED_CONTRADICTS_WEAK',
    alignment: 'ALIGNED',
    validation: 'CONTRADICTS',
    output: 'WEAK_BULLISH',  // Placeholder
    conditions: { 
      minConfidence: THRESHOLDS.WEAK_MIN_CONFIDENCE,
      readinessRequired: 'READY',
    },
    description: 'S+E aligned but on-chain contradicts - cautious weak if conditions met',
  },
  {
    id: 'ALIGNED_CONTRADICTS_INCONCLUSIVE',
    alignment: 'ALIGNED',
    validation: 'CONTRADICTS',
    output: 'INCONCLUSIVE',
    description: 'S+E aligned but on-chain contradicts and conditions not met',
  },
  
  // ─────────────────────────────────────────────────
  // PARTIAL (One NEUTRAL)
  // ─────────────────────────────────────────────────
  {
    id: 'PARTIAL_CONFIRMS_WEAK',
    alignment: 'PARTIAL',
    validation: 'CONFIRMS',
    output: 'WEAK_BULLISH',  // Placeholder
    description: 'One layer has direction, other neutral, on-chain confirms',
  },
  {
    id: 'PARTIAL_NODATA_NEUTRAL',
    alignment: 'PARTIAL',
    validation: 'NO_DATA',
    output: 'NEUTRAL',
    description: 'Partial alignment with no validation - stay neutral',
  },
  {
    id: 'PARTIAL_CONTRADICTS_NEUTRAL',
    alignment: 'PARTIAL',
    validation: 'CONTRADICTS',
    output: 'NEUTRAL',
    description: 'Partial alignment but reality contradicts - stay neutral',
  },
  
  // ─────────────────────────────────────────────────
  // CONFLICT (Sentiment != Exchange, both directional)
  // ─────────────────────────────────────────────────
  {
    id: 'CONFLICT_CONFIRMS_WEAK_EXCHANGE',
    alignment: 'CONFLICT',
    validation: 'CONFIRMS',
    output: 'WEAK_BULLISH',  // Placeholder: Exchange direction wins
    description: 'S≠E conflict but on-chain confirms Exchange - trust market mechanics',
  },
  {
    id: 'CONFLICT_NODATA_INCONCLUSIVE',
    alignment: 'CONFLICT',
    validation: 'NO_DATA',
    output: 'INCONCLUSIVE',
    description: 'Conflict with no validation - cannot decide',
  },
  {
    id: 'CONFLICT_CONTRADICTS_INCONCLUSIVE',
    alignment: 'CONFLICT',
    validation: 'CONTRADICTS',
    output: 'INCONCLUSIVE',
    description: 'Conflict and on-chain contradicts - hard stop',
  },
];

// ═══════════════════════════════════════════════════════════════
// MATRIX RUNNER
// ═══════════════════════════════════════════════════════════════

export interface MatrixInput {
  alignment: AlignmentType;
  validation: ValidationStatus;
  confAfterValidation: number;
  exchangeReadiness: 'READY' | 'DEGRADED';
  direction: 'BULLISH' | 'BEARISH';  // Primary direction (from Exchange in conflict)
}

export interface MatrixOutput {
  ruleId: string;
  rawVerdict: FinalVerdict;
  description: string;
}

/**
 * Run the decision matrix
 */
export function runDecisionMatrix(input: MatrixInput): MatrixOutput {
  const { alignment, validation, confAfterValidation, exchangeReadiness, direction } = input;
  
  // Find matching rule
  for (const rule of DECISION_MATRIX_V1) {
    if (rule.alignment !== alignment) continue;
    if (rule.validation !== validation) continue;
    
    // Check conditions if present
    if (rule.conditions) {
      if (rule.conditions.minConfidence !== undefined && 
          confAfterValidation < rule.conditions.minConfidence) {
        continue;
      }
      if (rule.conditions.readinessRequired !== undefined &&
          exchangeReadiness !== rule.conditions.readinessRequired) {
        continue;
      }
    }
    
    // Rule matched - apply direction
    const rawVerdict = applyDirection(rule.output, direction);
    
    return {
      ruleId: rule.id,
      rawVerdict,
      description: rule.description,
    };
  }
  
  // Fallback: should never reach here if matrix is complete
  return {
    ruleId: 'FALLBACK_INCONCLUSIVE',
    rawVerdict: 'INCONCLUSIVE',
    description: 'No matching rule found - defaulting to INCONCLUSIVE',
  };
}

/**
 * Apply actual direction to placeholder verdict
 */
function applyDirection(placeholder: FinalVerdict, direction: 'BULLISH' | 'BEARISH'): FinalVerdict {
  if (placeholder === 'NEUTRAL' || placeholder === 'INCONCLUSIVE') {
    return placeholder;
  }
  
  const isBullish = direction === 'BULLISH';
  
  if (placeholder.includes('STRONG')) {
    return isBullish ? 'STRONG_BULLISH' : 'STRONG_BEARISH';
  }
  
  if (placeholder.includes('WEAK')) {
    return isBullish ? 'WEAK_BULLISH' : 'WEAK_BEARISH';
  }
  
  return placeholder;
}

/**
 * Get matrix rules for transparency API
 */
export function getMatrixRules() {
  return {
    version: 'v1',
    thresholds: THRESHOLDS,
    validationMultipliers: VALIDATION_MULTIPLIERS,
    rules: DECISION_MATRIX_V1.map(r => ({
      id: r.id,
      alignment: r.alignment,
      validation: r.validation,
      output: r.output,
      conditions: r.conditions,
      description: r.description,
    })),
  };
}

console.log('[C3] Decision Matrix v1 loaded');
