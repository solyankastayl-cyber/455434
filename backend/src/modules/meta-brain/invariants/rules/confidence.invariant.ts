/**
 * CONFIDENCE INVARIANTS
 * =====================
 * 
 * Rules that govern confidence bounds.
 * 
 * @sealed v1.0
 */

import { InvariantLevel, InvariantDefinition, InvariantCheckContext } from '../invariants.types.js';

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE INVARIANTS
// ═══════════════════════════════════════════════════════════════

export const CONFIDENCE_INVARIANTS: InvariantDefinition<InvariantCheckContext>[] = [
  {
    id: 'CONF_BOUNDS',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'Confidence must be in [0, 1] range',
    rule: (ctx) => ctx.finalConfidence >= 0 && ctx.finalConfidence <= 1,
  },
  
  {
    id: 'CONF_NO_INFLATION',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'Final confidence cannot exceed base confidence',
    rule: (ctx) => ctx.finalConfidence <= ctx.baseConfidence + 0.001,
  },
  
  {
    id: 'CONF_MODIFIERS_BOUNDED',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'All modifiers must be <= 1 (cannot inflate)',
    rule: (ctx) => ctx.macroPenalty <= 1 && ctx.mlModifier <= 1,
  },
  
  {
    id: 'CONF_LOW_REQUIRES_AVOID',
    level: InvariantLevel.SOFT,
    source: 'SYSTEM',
    description: 'Very low confidence (< 0.3) should lead to AVOID',
    rule: (ctx) => {
      if (ctx.finalConfidence < 0.3 && ctx.finalAction !== 'AVOID') {
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
 * Validate confidence value is within bounds
 */
export function validateConfidence(value: number): { valid: boolean; error?: string } {
  if (value < 0) return { valid: false, error: 'Confidence cannot be negative' };
  if (value > 1) return { valid: false, error: 'Confidence cannot exceed 1' };
  if (!Number.isFinite(value)) return { valid: false, error: 'Confidence must be a finite number' };
  return { valid: true };
}

/**
 * Clamp confidence to valid range
 */
export function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Check if confidence was inflated
 */
export function isConfidenceInflated(base: number, final: number, epsilon = 0.001): boolean {
  return final > base + epsilon;
}

console.log('[Invariants] Confidence rules loaded');
