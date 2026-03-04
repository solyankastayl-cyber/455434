/**
 * INVARIANT RULES — INDEX
 * =======================
 * 
 * All invariant rules in one place.
 * 
 * @sealed v1.0
 */

export * from './confidence.invariant.js';
export * from './macro.invariant.js';
export * from './ml-scope.invariant.js';
export * from './decision.invariant.js';

import { CONFIDENCE_INVARIANTS } from './confidence.invariant.js';
import { MACRO_INVARIANTS } from './macro.invariant.js';
import { ML_INVARIANTS } from './ml-scope.invariant.js';
import { DECISION_INVARIANTS } from './decision.invariant.js';
import { InvariantDefinition, InvariantCheckContext } from '../invariants.types.js';

// ═══════════════════════════════════════════════════════════════
// ALL INVARIANTS COMBINED
// ═══════════════════════════════════════════════════════════════

export const ALL_INVARIANTS: InvariantDefinition<InvariantCheckContext>[] = [
  ...CONFIDENCE_INVARIANTS,
  ...MACRO_INVARIANTS,
  ...ML_INVARIANTS,
  ...DECISION_INVARIANTS,
];

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

export function getInvariantStats() {
  return {
    total: ALL_INVARIANTS.length,
    confidence: CONFIDENCE_INVARIANTS.length,
    macro: MACRO_INVARIANTS.length,
    ml: ML_INVARIANTS.length,
    decision: DECISION_INVARIANTS.length,
  };
}

console.log('[Invariants] All rules loaded:', getInvariantStats());
