/**
 * ML SCOPE INVARIANTS
 * ===================
 * 
 * Rules for ML behavior within Meta-Brain.
 * 
 * GOLDEN RULES:
 * - ML CANNOT change decision direction (BUY → SELL)
 * - ML CANNOT increase confidence
 * - ML CANNOT bypass macro blocks
 * - ML scope is CONFIDENCE_ONLY
 * 
 * @sealed v1.0
 */

import { InvariantLevel, InvariantDefinition, InvariantCheckContext } from '../invariants.types.js';

// ═══════════════════════════════════════════════════════════════
// ML SCOPE DEFINITION
// ═══════════════════════════════════════════════════════════════

export type MLScope = 'CONFIDENCE_ONLY' | 'DIRECTION_ONLY' | 'FULL' | 'NONE';

/**
 * LOCKED ML Scope for current system
 */
export const CURRENT_ML_SCOPE: MLScope = 'CONFIDENCE_ONLY';

// ═══════════════════════════════════════════════════════════════
// ML INVARIANTS
// ═══════════════════════════════════════════════════════════════

export const ML_INVARIANTS: InvariantDefinition<InvariantCheckContext>[] = [
  {
    id: 'ML_NO_DIRECTION_CHANGE',
    level: InvariantLevel.HARD,
    source: 'ML',
    description: 'ML CANNOT change decision direction (BUY/SELL/AVOID)',
    rule: (ctx) => {
      if (!ctx.mlApplied) return true;
      if (!ctx.mlAction) return true;
      // ML requested action must match base action
      return ctx.mlAction === ctx.baseAction;
    },
  },
  
  {
    id: 'ML_NO_CONFIDENCE_BOOST',
    level: InvariantLevel.HARD,
    source: 'ML',
    description: 'ML can ONLY lower confidence, NEVER increase',
    rule: (ctx) => {
      if (!ctx.mlApplied) return true;
      return ctx.mlModifier <= 1;
    },
  },
  
  {
    id: 'ML_RESPECTS_MACRO_BLOCKS',
    level: InvariantLevel.HARD,
    source: 'ML',
    description: 'ML cannot bypass macro blocks on STRONG actions',
    rule: (ctx) => {
      // If macro blocked strong, ML cannot unblock
      const macroBlocked = ctx.macroFlags.includes('STRONG_BLOCK') ||
                          ctx.macroFlags.includes('MACRO_PANIC') ||
                          ctx.macroRisk === 'EXTREME';
      
      if (macroBlocked) {
        // ML cannot make final strength STRONG if base wasn't STRONG
        if (ctx.baseStrength !== 'STRONG' && ctx.finalStrength === 'STRONG') {
          return false;
        }
      }
      return true;
    },
  },
  
  {
    id: 'ML_CANNOT_OVERRIDE_BLOCKED',
    level: InvariantLevel.HARD,
    source: 'ML',
    description: 'ML cannot override a BLOCKED verdict',
    rule: (ctx) => {
      // If base was AVOID due to blocking, final must be AVOID
      if (ctx.baseAction === 'AVOID' && ctx.macroRisk === 'EXTREME') {
        return ctx.finalAction === 'AVOID';
      }
      return true;
    },
  },
  
  {
    id: 'ML_MODIFIER_VALID',
    level: InvariantLevel.HARD,
    source: 'ML',
    description: 'ML modifier must be in valid range [0, 1]',
    rule: (ctx) => {
      if (!ctx.mlApplied) return true;
      return ctx.mlModifier >= 0 && ctx.mlModifier <= 1;
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if ML can modify the decision
 */
export function canMLModify(scope: MLScope, field: 'direction' | 'confidence'): boolean {
  switch (scope) {
    case 'CONFIDENCE_ONLY': return field === 'confidence';
    case 'DIRECTION_ONLY': return field === 'direction';
    case 'FULL': return true;
    case 'NONE': return false;
    default: return false;
  }
}

/**
 * Validate ML modifier
 */
export function validateMLModifier(modifier: number): { valid: boolean; error?: string } {
  if (modifier > 1) return { valid: false, error: 'ML modifier cannot exceed 1 (would inflate confidence)' };
  if (modifier < 0) return { valid: false, error: 'ML modifier cannot be negative' };
  if (!Number.isFinite(modifier)) return { valid: false, error: 'ML modifier must be a finite number' };
  return { valid: true };
}

/**
 * Check if ML is trying to change direction
 */
export function isMLChangingDirection(
  baseAction: string,
  mlRequestedAction: string | undefined
): boolean {
  if (!mlRequestedAction) return false;
  return baseAction !== mlRequestedAction;
}

/**
 * Check if ML is trying to boost confidence
 */
export function isMLBoostingConfidence(modifier: number): boolean {
  return modifier > 1;
}

console.log('[Invariants] ML scope rules loaded, current scope:', CURRENT_ML_SCOPE);
