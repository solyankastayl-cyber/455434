/**
 * DECISION INVARIANTS
 * ===================
 * 
 * Rules for final decision validity.
 * 
 * GOLDEN RULES:
 * - AVOID is terminal (cannot be overridden)
 * - Conflicts must resolve to AVOID
 * - Same input = Same output (deterministic)
 * 
 * @sealed v1.0
 */

import { InvariantLevel, InvariantDefinition, InvariantCheckContext } from '../invariants.types.js';

// ═══════════════════════════════════════════════════════════════
// DECISION TYPES
// ═══════════════════════════════════════════════════════════════

export type Decision = 'BUY' | 'SELL' | 'AVOID';
export type Strength = 'STRONG' | 'MODERATE' | 'WEAK';

// ═══════════════════════════════════════════════════════════════
// DECISION INVARIANTS
// ═══════════════════════════════════════════════════════════════

export const DECISION_INVARIANTS: InvariantDefinition<InvariantCheckContext>[] = [
  {
    id: 'DECISION_AVOID_TERMINAL',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'AVOID is terminal: cannot be overridden to BUY/SELL',
    rule: (ctx) => {
      // If base was AVOID, final must be AVOID
      if (ctx.baseAction === 'AVOID') {
        return ctx.finalAction === 'AVOID';
      }
      return true;
    },
  },
  
  {
    id: 'DECISION_CONFLICT_FORCES_AVOID',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'Unresolved conflict + low confidence = AVOID',
    rule: (ctx) => {
      if (ctx.hasConflict && ctx.finalConfidence < 0.4) {
        return ctx.decision === 'AVOID';
      }
      return true;
    },
  },
  
  {
    id: 'DECISION_VALID_TYPE',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'Decision must be BUY, SELL, or AVOID',
    rule: (ctx) => {
      const validDecisions: Decision[] = ['BUY', 'SELL', 'AVOID'];
      return validDecisions.includes(ctx.decision);
    },
  },
  
  {
    id: 'DECISION_STRENGTH_VALID',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'Strength must be STRONG, MODERATE, or WEAK',
    rule: (ctx) => {
      const validStrengths: Strength[] = ['STRONG', 'MODERATE', 'WEAK'];
      return validStrengths.includes(ctx.finalStrength);
    },
  },
  
  {
    id: 'DECISION_STRENGTH_MATCHES_CONFIDENCE',
    level: InvariantLevel.SOFT,
    source: 'SYSTEM',
    description: 'Strength should correlate with confidence',
    rule: (ctx) => {
      // STRONG only with high confidence
      if (ctx.finalStrength === 'STRONG' && ctx.finalConfidence < 0.6) {
        return false;
      }
      // WEAK should have lower confidence
      if (ctx.finalStrength === 'WEAK' && ctx.finalConfidence > 0.7) {
        return false;
      }
      return true;
    },
    penalty: 0.95,
  },
  
  {
    id: 'DECISION_AVOID_ZERO_ACTION',
    level: InvariantLevel.SOFT,
    source: 'SYSTEM',
    description: 'AVOID should have lower confidence indication',
    rule: (ctx) => {
      // AVOID with very high confidence is suspicious
      if (ctx.finalAction === 'AVOID' && ctx.finalConfidence > 0.8) {
        return false;
      }
      return true;
    },
    penalty: 0.9,
  },
];

// ═══════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if AVOID can be overridden
 */
export function canOverrideAvoid(): boolean {
  // AVOID is terminal - NEVER can be overridden
  return false;
}

/**
 * Get expected strength for confidence
 */
export function getExpectedStrength(confidence: number): Strength {
  if (confidence >= 0.7) return 'STRONG';
  if (confidence >= 0.4) return 'MODERATE';
  return 'WEAK';
}

/**
 * Validate decision type
 */
export function validateDecision(decision: string): { valid: boolean; error?: string } {
  const validDecisions = ['BUY', 'SELL', 'AVOID'];
  if (!validDecisions.includes(decision)) {
    return { valid: false, error: `Invalid decision: ${decision}. Must be BUY, SELL, or AVOID` };
  }
  return { valid: true };
}

/**
 * Validate strength type
 */
export function validateStrength(strength: string): { valid: boolean; error?: string } {
  const validStrengths = ['STRONG', 'MODERATE', 'WEAK'];
  if (!validStrengths.includes(strength)) {
    return { valid: false, error: `Invalid strength: ${strength}. Must be STRONG, MODERATE, or WEAK` };
  }
  return { valid: true };
}

/**
 * Check if conflict should force AVOID
 */
export function shouldConflictForceAvoid(hasConflict: boolean, confidence: number): boolean {
  return hasConflict && confidence < 0.4;
}

console.log('[Invariants] Decision rules loaded');
