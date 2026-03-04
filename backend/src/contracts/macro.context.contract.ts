/**
 * MACRO CONTEXT CONTRACT — P0.3
 * =============================
 * 
 * Frozen contract for Macro → Decision interaction.
 * Version bumps require explicit approval.
 * 
 * @sealed v1.0
 */

// ═══════════════════════════════════════════════════════════════
// CONTRACT VERSION
// ═══════════════════════════════════════════════════════════════

export const MACRO_CONTEXT_VERSION = 'v1.0';
export const MACRO_CONTEXT_FROZEN_AT = '2026-02-09';

// ═══════════════════════════════════════════════════════════════
// REGIME IDS (CANONICAL, FROZEN)
// ═══════════════════════════════════════════════════════════════

export const MACRO_REGIME_IDS = {
  BTC_FLIGHT_TO_SAFETY: 0,
  PANIC_SELL_OFF: 1,
  BTC_LEADS_ALT_FOLLOW: 2,
  BTC_MAX_PRESSURE: 3,
  ALT_ROTATION: 4,
  FULL_RISK_OFF: 5,
  ALT_SEASON: 6,
  CAPITAL_EXIT: 7,
  NEUTRAL: 8,
} as const;

export type MacroRegimeId = keyof typeof MACRO_REGIME_IDS;

// ═══════════════════════════════════════════════════════════════
// RISK LEVELS (CANONICAL, FROZEN)
// ═══════════════════════════════════════════════════════════════

export const RISK_LEVELS = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  EXTREME: 3,
} as const;

export type RiskLevel = keyof typeof RISK_LEVELS;

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE MULTIPLIERS (FROZEN)
// ═══════════════════════════════════════════════════════════════

export const CONFIDENCE_MULTIPLIERS: Record<RiskLevel, number> = {
  LOW: 1.0,
  MEDIUM: 0.85,
  HIGH: 0.7,
  EXTREME: 0.5,
};

// ═══════════════════════════════════════════════════════════════
// REGIME → RISK MAPPING (FROZEN)
// ═══════════════════════════════════════════════════════════════

export const REGIME_RISK_MAP: Record<MacroRegimeId, RiskLevel> = {
  ALT_SEASON: 'LOW',
  BTC_LEADS_ALT_FOLLOW: 'LOW',
  BTC_FLIGHT_TO_SAFETY: 'MEDIUM',
  ALT_ROTATION: 'MEDIUM',
  NEUTRAL: 'MEDIUM',
  FULL_RISK_OFF: 'HIGH',
  BTC_MAX_PRESSURE: 'HIGH',
  PANIC_SELL_OFF: 'EXTREME',
  CAPITAL_EXIT: 'EXTREME',
};

// ═══════════════════════════════════════════════════════════════
// BLOCKED ACTIONS (FROZEN)
// ═══════════════════════════════════════════════════════════════

export type DecisionType = 'BUY' | 'SELL' | 'AVOID' | 'STRONG_BUY' | 'STRONG_SELL';

export const REGIME_BLOCKED_ACTIONS: Record<MacroRegimeId, DecisionType[]> = {
  ALT_SEASON: [],
  BTC_LEADS_ALT_FOLLOW: [],
  BTC_FLIGHT_TO_SAFETY: ['STRONG_BUY', 'STRONG_SELL'],
  ALT_ROTATION: [],
  NEUTRAL: [],
  FULL_RISK_OFF: ['BUY', 'SELL', 'STRONG_BUY', 'STRONG_SELL'],
  BTC_MAX_PRESSURE: ['STRONG_BUY'],
  PANIC_SELL_OFF: ['BUY', 'STRONG_BUY', 'STRONG_SELL'],
  CAPITAL_EXIT: ['BUY', 'STRONG_BUY', 'STRONG_SELL'],
};

// ═══════════════════════════════════════════════════════════════
// MACRO CONTEXT CONTRACT
// ═══════════════════════════════════════════════════════════════

export interface MacroContextContract {
  /** Contract version (REQUIRED) */
  version: string;
  
  /** Regime ID (REQUIRED) */
  regimeId: MacroRegimeId;
  
  /** Numeric regime code (REQUIRED) */
  regimeCode: number;
  
  /** Risk level (REQUIRED) */
  riskLevel: RiskLevel;
  
  /** Confidence multiplier (REQUIRED, <= 1) */
  confidenceMultiplier: number;
  
  /** Blocked decision types (REQUIRED) */
  blocks: DecisionType[];
  
  /** Active macro flags */
  flags: string[];
  
  /** Fear & Greed (0-100) */
  fearGreed?: number;
  
  /** BTC dominance (%) */
  btcDominance?: number;
  
  /** Stablecoin dominance (%) */
  stableDominance?: number;
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildMacroContextContract(
  regimeId: MacroRegimeId,
  options?: {
    flags?: string[];
    fearGreed?: number;
    btcDominance?: number;
    stableDominance?: number;
  }
): MacroContextContract {
  const riskLevel = REGIME_RISK_MAP[regimeId];
  
  return {
    version: MACRO_CONTEXT_VERSION,
    regimeId,
    regimeCode: MACRO_REGIME_IDS[regimeId],
    riskLevel,
    confidenceMultiplier: CONFIDENCE_MULTIPLIERS[riskLevel],
    blocks: REGIME_BLOCKED_ACTIONS[regimeId],
    flags: options?.flags || [],
    fearGreed: options?.fearGreed,
    btcDominance: options?.btcDominance,
    stableDominance: options?.stableDominance,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT VALIDATION
// ═══════════════════════════════════════════════════════════════

export interface ContractValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateMacroContextContract(
  context: Partial<MacroContextContract>
): ContractValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Version check
  if (!context.version) {
    errors.push('version is REQUIRED');
  } else if (context.version !== MACRO_CONTEXT_VERSION) {
    warnings.push(`version mismatch: expected ${MACRO_CONTEXT_VERSION}, got ${context.version}`);
  }
  
  // Regime check
  if (!context.regimeId) {
    errors.push('regimeId is REQUIRED');
  } else if (!(context.regimeId in MACRO_REGIME_IDS)) {
    errors.push(`unknown regimeId: ${context.regimeId}`);
  }
  
  // Risk level check
  if (!context.riskLevel) {
    errors.push('riskLevel is REQUIRED');
  } else if (!(context.riskLevel in RISK_LEVELS)) {
    errors.push(`unknown riskLevel: ${context.riskLevel}`);
  }
  
  // Confidence multiplier check
  if (context.confidenceMultiplier === undefined) {
    errors.push('confidenceMultiplier is REQUIRED');
  } else if (context.confidenceMultiplier > 1) {
    errors.push('confidenceMultiplier cannot exceed 1');
  } else if (context.confidenceMultiplier < 0) {
    errors.push('confidenceMultiplier cannot be negative');
  }
  
  // Blocks check
  if (!context.blocks) {
    errors.push('blocks array is REQUIRED');
  }
  
  // Cross-validation
  if (context.regimeId && context.riskLevel) {
    const expectedRisk = REGIME_RISK_MAP[context.regimeId as MacroRegimeId];
    if (expectedRisk !== context.riskLevel) {
      warnings.push(`riskLevel mismatch: ${context.regimeId} should have ${expectedRisk}, not ${context.riskLevel}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT ENFORCEMENT
// ═══════════════════════════════════════════════════════════════

export class MacroContractViolationError extends Error {
  public readonly violations: string[];
  
  constructor(violations: string[]) {
    super(`Macro contract violation: ${violations.join(', ')}`);
    this.name = 'MacroContractViolationError';
    this.violations = violations;
  }
}

export function enforceMacroContextContract(
  context: Partial<MacroContextContract>
): asserts context is MacroContextContract {
  const result = validateMacroContextContract(context);
  
  if (!result.valid) {
    throw new MacroContractViolationError(result.errors);
  }
}

// ═══════════════════════════════════════════════════════════════
// VERSION CHECK
// ═══════════════════════════════════════════════════════════════

export function isContractVersionCompatible(version: string): boolean {
  // For now, exact match required
  return version === MACRO_CONTEXT_VERSION;
}

export function getContractInfo(): {
  version: string;
  frozenAt: string;
  regimesCount: number;
  riskLevels: number;
} {
  return {
    version: MACRO_CONTEXT_VERSION,
    frozenAt: MACRO_CONTEXT_FROZEN_AT,
    regimesCount: Object.keys(MACRO_REGIME_IDS).length,
    riskLevels: Object.keys(RISK_LEVELS).length,
  };
}

console.log('[P0.3] Macro context contract loaded:', getContractInfo());
