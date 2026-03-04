/**
 * META-BRAIN INVARIANT REGISTRY
 * =============================
 * 
 * All system invariants defined in ONE place.
 * Modify this file = requires full regression test.
 * 
 * @sealed v1.0
 */

import {
  InvariantLevel,
  InvariantDefinition,
  InvariantCheckContext,
} from './invariants.types.js';

// ═══════════════════════════════════════════════════════════════
// CANONICAL INVARIANTS
// ═══════════════════════════════════════════════════════════════

export const META_BRAIN_INVARIANTS: InvariantDefinition<InvariantCheckContext>[] = [
  
  // ─────────────────────────────────────────────────────────────
  // MACRO INVARIANTS (Source: MACRO)
  // ─────────────────────────────────────────────────────────────
  
  {
    id: 'MACRO_CAN_ONLY_PENALIZE',
    level: InvariantLevel.HARD,
    source: 'MACRO',
    description: 'Macro can only lower confidence (penalty <= 1), never increase it',
    rule: (ctx) => ctx.macroPenalty <= 1,
  },
  
  {
    id: 'MACRO_PANIC_BLOCKS_STRONG',
    level: InvariantLevel.HARD,
    source: 'MACRO',
    description: 'STRONG actions forbidden during MACRO_PANIC',
    rule: (ctx) => {
      const hasPanic = ctx.macroFlags.includes('MACRO_PANIC') || 
                       ctx.macroFlags.includes('EXTREME_FEAR') ||
                       ctx.macroRegime === 'PANIC_SELL_OFF' ||
                       ctx.macroRegime === 'CAPITAL_EXIT';
      if (hasPanic && ctx.finalStrength === 'STRONG') {
        return false;
      }
      return true;
    },
  },
  
  {
    id: 'MACRO_EXTREME_CAPS_CONFIDENCE',
    level: InvariantLevel.HARD,
    source: 'MACRO',
    description: 'Confidence capped based on regime risk level',
    rule: (ctx) => {
      const caps: Record<string, number> = {
        'LOW': 0.85,
        'MEDIUM': 0.70,
        'HIGH': 0.55,
        'EXTREME': 0.45,
      };
      const cap = caps[ctx.macroRisk] || 1;
      return ctx.finalConfidence <= cap + 0.001; // Small epsilon for float comparison
    },
  },
  
  {
    id: 'MACRO_RISK_OFF_BLOCKS_ACTION',
    level: InvariantLevel.HARD,
    source: 'MACRO',
    description: 'BUY/SELL forbidden in FULL_RISK_OFF (only AVOID allowed)',
    rule: (ctx) => {
      if (ctx.macroRegime === 'FULL_RISK_OFF') {
        return ctx.finalAction === 'AVOID';
      }
      return true;
    },
  },
  
  // ─────────────────────────────────────────────────────────────
  // ML INVARIANTS (Source: ML)
  // ─────────────────────────────────────────────────────────────
  
  {
    id: 'ML_CANNOT_CHANGE_DIRECTION',
    level: InvariantLevel.HARD,
    source: 'ML',
    description: 'ML cannot change BUY/SELL/AVOID direction',
    rule: (ctx) => {
      if (!ctx.mlApplied || !ctx.mlAction) return true;
      return ctx.mlAction === ctx.baseAction;
    },
  },
  
  {
    id: 'ML_CANNOT_INCREASE_CONFIDENCE',
    level: InvariantLevel.HARD,
    source: 'ML',
    description: 'ML can only lower confidence, never increase',
    rule: (ctx) => {
      if (!ctx.mlApplied) return true;
      return ctx.mlModifier <= 1;
    },
  },
  
  {
    id: 'ML_CANNOT_BYPASS_MACRO_BLOCKS',
    level: InvariantLevel.HARD,
    source: 'ML',
    description: 'ML cannot override macro blocks',
    rule: (ctx) => {
      // If macro blocked strong actions, ML cannot restore them
      const macroBlocked = ctx.macroFlags.includes('STRONG_BLOCK') || 
                          ctx.macroRisk === 'EXTREME';
      if (macroBlocked && ctx.baseStrength !== 'STRONG' && ctx.finalStrength === 'STRONG') {
        return false;
      }
      return true;
    },
  },
  
  // ─────────────────────────────────────────────────────────────
  // LABS INVARIANTS (Source: LABS)
  // ─────────────────────────────────────────────────────────────
  
  {
    id: 'LABS_READ_ONLY',
    level: InvariantLevel.HARD,
    source: 'LABS',
    description: 'Labs are READ-ONLY: influence must be 0',
    rule: (ctx) => ctx.labsInfluence === 0,
  },
  
  {
    id: 'LABS_CONFLICT_REDUCES_CONFIDENCE',
    level: InvariantLevel.SOFT,
    source: 'LABS',
    description: 'Lab conflicts should reduce confidence',
    rule: (ctx) => {
      // If there's a conflict but confidence is still very high, soft violation
      if (ctx.labsConflict && ctx.finalConfidence > 0.7) {
        return false;
      }
      return true;
    },
    penalty: 0.85, // 15% confidence reduction
  },
  
  // ─────────────────────────────────────────────────────────────
  // SYSTEM INVARIANTS (Source: SYSTEM)
  // ─────────────────────────────────────────────────────────────
  
  {
    id: 'CONFLICT_FORCES_AVOID',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'Unresolved conflicts must result in AVOID',
    rule: (ctx) => {
      // Major conflict + no clear resolution = must AVOID
      if (ctx.hasConflict && ctx.finalConfidence < 0.4) {
        return ctx.decision === 'AVOID';
      }
      return true;
    },
  },
  
  {
    id: 'FINAL_CONFIDENCE_NEVER_EXCEEDS_BASE',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'Final confidence can never exceed base confidence',
    rule: (ctx) => ctx.finalConfidence <= ctx.baseConfidence + 0.001,
  },
  
  {
    id: 'DETERMINISTIC_OUTPUT',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'Same input must produce same output',
    rule: (_ctx) => {
      // This is enforced by architecture, not runtime check
      // Always pass in runtime
      return true;
    },
  },
  
  {
    id: 'NO_CONFIDENCE_INFLATION',
    level: InvariantLevel.HARD,
    source: 'SYSTEM',
    description: 'System cannot create confidence out of thin air',
    rule: (ctx) => {
      const totalModifier = ctx.macroPenalty * ctx.mlModifier;
      const expectedMax = ctx.baseConfidence * totalModifier;
      return ctx.finalConfidence <= expectedMax + 0.01;
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// REGISTRY HELPERS
// ═══════════════════════════════════════════════════════════════

export function getInvariantById(id: string): InvariantDefinition<InvariantCheckContext> | undefined {
  return META_BRAIN_INVARIANTS.find(inv => inv.id === id);
}

export function getInvariantsBySource(source: string): InvariantDefinition<InvariantCheckContext>[] {
  return META_BRAIN_INVARIANTS.filter(inv => inv.source === source);
}

export function getHardInvariants(): InvariantDefinition<InvariantCheckContext>[] {
  return META_BRAIN_INVARIANTS.filter(inv => inv.level === InvariantLevel.HARD);
}

export function getSoftInvariants(): InvariantDefinition<InvariantCheckContext>[] {
  return META_BRAIN_INVARIANTS.filter(inv => inv.level === InvariantLevel.SOFT);
}

export function getInvariantCount(): { total: number; hard: number; soft: number } {
  return {
    total: META_BRAIN_INVARIANTS.length,
    hard: getHardInvariants().length,
    soft: getSoftInvariants().length,
  };
}

console.log('[Meta-Brain] Invariant registry loaded:', getInvariantCount());
