/**
 * META-BRAIN INVARIANT GUARD
 * ==========================
 * 
 * HARD INVARIANTS that MUST NEVER be violated.
 * These are tested on every verdict and in regression tests.
 * 
 * HIERARCHY (IMMUTABLE):
 *   Macro > Rules > ML > Labs > Signals
 * 
 * Any attempt to violate these invariants MUST throw or return blocked.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type MacroRegimeRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type VerdictAction = 'BUY' | 'SELL' | 'AVOID';
export type VerdictStrength = 'STRONG' | 'MODERATE' | 'WEAK';

export interface InvariantContext {
  regime: string;
  riskLevel: MacroRegimeRisk;
  macroFlags: string[];
  baseAction: VerdictAction;
  baseStrength: VerdictStrength;
  baseConfidence: number;
  mlWantsAction?: VerdictAction;
  mlWantsConfidence?: number;
}

export interface InvariantResult {
  passed: boolean;
  violations: string[];
  finalAction: VerdictAction;
  finalStrength: VerdictStrength;
  finalConfidence: number;
  blocked: boolean;
  blockReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Regimes where STRONG actions are BLOCKED
const STRONG_BLOCKED_REGIMES = [
  'PANIC_SELL_OFF',
  'CAPITAL_EXIT',
  'FULL_RISK_OFF',
];

// Regimes where BUY/SELL are FORBIDDEN (only AVOID allowed)
const ACTION_FORBIDDEN_REGIMES = [
  'FULL_RISK_OFF',
];

// Macro flags that block STRONG actions
const STRONG_BLOCKED_FLAGS = [
  'MACRO_PANIC',
  'EXTREME_FEAR',
  'STRONG_BLOCK',
];

// Maximum confidence by regime risk level
const MAX_CONFIDENCE_BY_RISK: Record<MacroRegimeRisk, number> = {
  'LOW': 0.85,
  'MEDIUM': 0.70,
  'HIGH': 0.55,
  'EXTREME': 0.45,
};

// ═══════════════════════════════════════════════════════════════
// INVARIANT #1: MACRO PRECEDENCE
// Macro ALWAYS has priority over everything else
// ═══════════════════════════════════════════════════════════════

export function assertMacroPrecedence(ctx: InvariantContext): { passed: boolean; violation?: string } {
  const violations: string[] = [];
  
  // Check 1: STRONG blocked in extreme regimes
  if (STRONG_BLOCKED_REGIMES.includes(ctx.regime) && ctx.baseStrength === 'STRONG') {
    violations.push(`STRONG action not allowed in ${ctx.regime}`);
  }
  
  // Check 2: STRONG blocked by macro flags
  const blockingFlag = ctx.macroFlags.find(f => STRONG_BLOCKED_FLAGS.includes(f));
  if (blockingFlag && ctx.baseStrength === 'STRONG') {
    violations.push(`STRONG action not allowed with flag ${blockingFlag}`);
  }
  
  // Check 3: Action forbidden in certain regimes
  if (ACTION_FORBIDDEN_REGIMES.includes(ctx.regime) && ctx.baseAction !== 'AVOID') {
    violations.push(`${ctx.baseAction} action forbidden in ${ctx.regime}`);
  }
  
  return {
    passed: violations.length === 0,
    violation: violations.join('; '),
  };
}

// ═══════════════════════════════════════════════════════════════
// INVARIANT #2: ML NEVER OVERRIDES RULES
// ML can ONLY lower confidence, NEVER change direction or strengthen
// ═══════════════════════════════════════════════════════════════

export function assertMLNeverOverridesRules(ctx: InvariantContext): { passed: boolean; violation?: string } {
  const violations: string[] = [];
  
  // Rule 1: ML cannot change action direction
  if (ctx.mlWantsAction && ctx.mlWantsAction !== ctx.baseAction) {
    violations.push(`ML tried to change action from ${ctx.baseAction} to ${ctx.mlWantsAction}`);
  }
  
  // Rule 2: ML cannot increase confidence
  if (ctx.mlWantsConfidence !== undefined && ctx.mlWantsConfidence > ctx.baseConfidence) {
    violations.push(`ML tried to increase confidence from ${ctx.baseConfidence} to ${ctx.mlWantsConfidence}`);
  }
  
  return {
    passed: violations.length === 0,
    violation: violations.join('; '),
  };
}

// ═══════════════════════════════════════════════════════════════
// INVARIANT #3: CONFIDENCE CAPPED BY REGIME
// Confidence cannot exceed macro-defined cap
// ═══════════════════════════════════════════════════════════════

export function assertConfidenceWithinCap(ctx: InvariantContext): { passed: boolean; violation?: string; cap: number } {
  const cap = MAX_CONFIDENCE_BY_RISK[ctx.riskLevel];
  
  if (ctx.baseConfidence > cap) {
    return {
      passed: false,
      violation: `Confidence ${ctx.baseConfidence} exceeds cap ${cap} for ${ctx.riskLevel} risk`,
      cap,
    };
  }
  
  return { passed: true, cap };
}

// ═══════════════════════════════════════════════════════════════
// INVARIANT #4: NO STRONG ACTION DURING PANIC
// STRONG is forbidden when market is in panic state
// ═══════════════════════════════════════════════════════════════

export function assertNoStrongActionDuringPanic(ctx: InvariantContext): { passed: boolean; violation?: string } {
  const panicIndicators = [
    ctx.regime === 'PANIC_SELL_OFF',
    ctx.regime === 'CAPITAL_EXIT',
    ctx.macroFlags.includes('MACRO_PANIC'),
    ctx.macroFlags.includes('EXTREME_FEAR'),
    ctx.riskLevel === 'EXTREME',
  ];
  
  const isPanic = panicIndicators.some(Boolean);
  
  if (isPanic && ctx.baseStrength === 'STRONG') {
    return {
      passed: false,
      violation: 'STRONG action forbidden during panic conditions',
    };
  }
  
  return { passed: true };
}

// ═══════════════════════════════════════════════════════════════
// MAIN GUARD: VALIDATE ALL INVARIANTS
// ═══════════════════════════════════════════════════════════════

export function validateInvariants(ctx: InvariantContext): InvariantResult {
  const violations: string[] = [];
  let blocked = false;
  let blockReason: string | undefined;
  
  // Apply invariants
  const macroCheck = assertMacroPrecedence(ctx);
  if (!macroCheck.passed) {
    violations.push(macroCheck.violation!);
    blocked = true;
    blockReason = macroCheck.violation;
  }
  
  const mlCheck = assertMLNeverOverridesRules(ctx);
  if (!mlCheck.passed) {
    violations.push(mlCheck.violation!);
  }
  
  const confCheck = assertConfidenceWithinCap(ctx);
  if (!confCheck.passed) {
    violations.push(confCheck.violation!);
  }
  
  const panicCheck = assertNoStrongActionDuringPanic(ctx);
  if (!panicCheck.passed) {
    violations.push(panicCheck.violation!);
    blocked = true;
    blockReason = panicCheck.violation;
  }
  
  // Calculate final values
  let finalAction = ctx.baseAction;
  let finalStrength = ctx.baseStrength;
  let finalConfidence = Math.min(ctx.baseConfidence, confCheck.cap);
  
  // Apply blocks
  if (blocked) {
    // Downgrade strength
    if (finalStrength === 'STRONG') {
      finalStrength = 'WEAK';
    }
    
    // In extreme cases, force AVOID
    if (ACTION_FORBIDDEN_REGIMES.includes(ctx.regime)) {
      finalAction = 'AVOID';
    }
  }
  
  return {
    passed: violations.length === 0,
    violations,
    finalAction,
    finalStrength,
    finalConfidence,
    blocked,
    blockReason,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORT FOR TESTING
// ═══════════════════════════════════════════════════════════════

export const INVARIANT_CONSTANTS = {
  STRONG_BLOCKED_REGIMES,
  ACTION_FORBIDDEN_REGIMES,
  STRONG_BLOCKED_FLAGS,
  MAX_CONFIDENCE_BY_RISK,
};
