/**
 * MACRO INVARIANTS
 * ================
 * 
 * Rules for Macro Context Layer behavior.
 * 
 * GOLDEN RULES:
 * - Macro can ONLY penalize (never boost)
 * - Macro can BLOCK strong actions during extreme regimes
 * - Macro provides CONTEXT, not decisions
 * 
 * @sealed v1.0
 */

import { InvariantLevel, InvariantDefinition, InvariantCheckContext } from '../invariants.types.js';

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFICATIONS
// ═══════════════════════════════════════════════════════════════

export const BLOCKING_REGIMES = [
  'PANIC_SELL_OFF',
  'CAPITAL_EXIT', 
  'FULL_RISK_OFF',
] as const;

export const PANIC_FLAGS = [
  'MACRO_PANIC',
  'EXTREME_FEAR',
  'STRONG_BLOCK',
] as const;

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] as const;

// Confidence caps by risk level
export const RISK_CONFIDENCE_CAPS: Record<string, number> = {
  'LOW': 0.85,
  'MEDIUM': 0.70,
  'HIGH': 0.55,
  'EXTREME': 0.45,
};

// ═══════════════════════════════════════════════════════════════
// MACRO INVARIANTS
// ═══════════════════════════════════════════════════════════════

export const MACRO_INVARIANTS: InvariantDefinition<InvariantCheckContext>[] = [
  {
    id: 'MACRO_ONLY_PENALIZE',
    level: InvariantLevel.HARD,
    source: 'MACRO',
    description: 'Macro can only lower confidence (penalty <= 1), NEVER increase',
    rule: (ctx) => ctx.macroPenalty <= 1,
  },
  
  {
    id: 'MACRO_PANIC_BLOCKS_STRONG',
    level: InvariantLevel.HARD,
    source: 'MACRO',
    description: 'STRONG actions FORBIDDEN during PANIC regimes',
    rule: (ctx) => {
      const hasPanic = ctx.macroFlags.some(f => 
        PANIC_FLAGS.includes(f as typeof PANIC_FLAGS[number])
      );
      const hasPanicRegime = BLOCKING_REGIMES.includes(
        ctx.macroRegime as typeof BLOCKING_REGIMES[number]
      );
      
      if ((hasPanic || hasPanicRegime) && ctx.finalStrength === 'STRONG') {
        return false;
      }
      return true;
    },
  },
  
  {
    id: 'MACRO_RISK_CAPS_CONFIDENCE',
    level: InvariantLevel.HARD,
    source: 'MACRO',
    description: 'Confidence capped based on risk level',
    rule: (ctx) => {
      const cap = RISK_CONFIDENCE_CAPS[ctx.macroRisk] || 1;
      return ctx.finalConfidence <= cap + 0.001;
    },
  },
  
  {
    id: 'MACRO_FULL_RISK_OFF_ONLY_AVOID',
    level: InvariantLevel.HARD,
    source: 'MACRO',
    description: 'In FULL_RISK_OFF regime, ONLY AVOID is allowed',
    rule: (ctx) => {
      if (ctx.macroRegime === 'FULL_RISK_OFF') {
        return ctx.finalAction === 'AVOID';
      }
      return true;
    },
  },
  
  {
    id: 'MACRO_EXTREME_RISK_BLOCKS_ACTION',
    level: InvariantLevel.HARD,
    source: 'MACRO',
    description: 'EXTREME risk must cap confidence at 0.45',
    rule: (ctx) => {
      if (ctx.macroRisk === 'EXTREME') {
        return ctx.finalConfidence <= 0.45 + 0.001;
      }
      return true;
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if regime blocks strong actions
 */
export function isRegimeBlocking(regime: string, flags: string[]): boolean {
  if (BLOCKING_REGIMES.includes(regime as any)) return true;
  if (flags.some(f => PANIC_FLAGS.includes(f as any))) return true;
  return false;
}

/**
 * Get confidence cap for risk level
 */
export function getConfidenceCapForRisk(risk: string): number {
  return RISK_CONFIDENCE_CAPS[risk] || 1.0;
}

/**
 * Check if action is allowed in regime
 */
export function isActionAllowedInRegime(
  action: 'BUY' | 'SELL' | 'AVOID',
  regime: string
): boolean {
  if (regime === 'FULL_RISK_OFF') return action === 'AVOID';
  return true;
}

/**
 * Validate macro penalty value
 */
export function validateMacroPenalty(penalty: number): { valid: boolean; error?: string } {
  if (penalty > 1) return { valid: false, error: 'Macro penalty cannot exceed 1 (would inflate confidence)' };
  if (penalty < 0) return { valid: false, error: 'Macro penalty cannot be negative' };
  return { valid: true };
}

console.log('[Invariants] Macro rules loaded, blocking regimes:', BLOCKING_REGIMES.length);
