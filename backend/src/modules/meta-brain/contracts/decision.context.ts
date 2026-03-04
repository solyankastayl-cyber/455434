/**
 * DECISION CONTEXT CONTRACT
 * =========================
 * 
 * P0.3: Market Regime → Decision Contract Lock
 * 
 * macroContext is MANDATORY in every verdict.
 * No verdict without macro.regime and macro.confidenceMultiplier.
 * 
 * @sealed v1.0
 */

// ═══════════════════════════════════════════════════════════════
// MARKET REGIME IDS (CANONICAL)
// ═══════════════════════════════════════════════════════════════

export type MarketRegimeId =
  | 'BTC_FLIGHT_TO_SAFETY'
  | 'PANIC_SELL_OFF'
  | 'BTC_LEADS_ALT_FOLLOW'
  | 'BTC_MAX_PRESSURE'
  | 'ALT_ROTATION'
  | 'FULL_RISK_OFF'
  | 'ALT_SEASON'
  | 'CAPITAL_EXIT'
  | 'NEUTRAL';

// ═══════════════════════════════════════════════════════════════
// RISK LEVELS
// ═══════════════════════════════════════════════════════════════

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

// ═══════════════════════════════════════════════════════════════
// ACTION TYPES
// ═══════════════════════════════════════════════════════════════

export type DecisionAction = 'BUY' | 'SELL' | 'AVOID';

// ═══════════════════════════════════════════════════════════════
// DECISION CONTEXT (MANDATORY in every verdict)
// ═══════════════════════════════════════════════════════════════

export interface DecisionMacroContext {
  /** Current market regime (REQUIRED) */
  regime: MarketRegimeId;
  
  /** Risk level (REQUIRED) */
  riskLevel: RiskLevel;
  
  /** Actions blocked by macro (REQUIRED) */
  blocks: DecisionAction[];
  
  /** Confidence multiplier (REQUIRED, must be <= 1) */
  confidenceMultiplier: number;
  
  /** Active macro flags */
  flags?: string[];
  
  /** Fear & Greed index (0-100) */
  fearGreed?: number;
  
  /** BTC dominance (%) */
  btcDominance?: number;
  
  /** Stablecoin dominance (%) */
  stableDominance?: number;
}

export interface DecisionContext {
  /** Macro context is MANDATORY */
  macro: DecisionMacroContext;
  
  /** Decision timestamp */
  timestamp: number;
  
  /** Data mode */
  dataMode: 'LIVE' | 'MOCK' | 'REPLAY';
  
  /** Symbol being analyzed */
  symbol: string;
}

// ═══════════════════════════════════════════════════════════════
// VERDICT WITH CONTEXT (enforced structure)
// ═══════════════════════════════════════════════════════════════

export interface VerdictWithContext {
  /** Final decision */
  decision: DecisionAction;
  
  /** Confidence (0..1, capped by macro) */
  confidence: number;
  
  /** Strength (blocked to WEAK if macro says so) */
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  
  /** Direction of signal */
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  
  /** MANDATORY: Decision context with macro */
  context: DecisionContext;
  
  /** Invariant check results */
  invariants: {
    passed: boolean;
    violations: string[];
  };
  
  /** Explainability */
  explain: {
    summary: string;
    macroImpact: string;
    reasons: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export class DecisionContextError extends Error {
  public readonly field: string;
  
  constructor(field: string, message: string) {
    super(`DecisionContext validation failed: ${field} - ${message}`);
    this.name = 'DecisionContextError';
    this.field = field;
  }
}

/**
 * Validate that DecisionContext is complete
 * Throws if missing required fields
 */
export function validateDecisionContext(ctx: Partial<DecisionContext>): asserts ctx is DecisionContext {
  // macro is required
  if (!ctx.macro) {
    throw new DecisionContextError('macro', 'macro context is REQUIRED');
  }
  
  // macro.regime is required
  if (!ctx.macro.regime) {
    throw new DecisionContextError('macro.regime', 'regime is REQUIRED');
  }
  
  // macro.riskLevel is required
  if (!ctx.macro.riskLevel) {
    throw new DecisionContextError('macro.riskLevel', 'riskLevel is REQUIRED');
  }
  
  // macro.confidenceMultiplier is required and must be <= 1
  if (ctx.macro.confidenceMultiplier === undefined || ctx.macro.confidenceMultiplier === null) {
    throw new DecisionContextError('macro.confidenceMultiplier', 'confidenceMultiplier is REQUIRED');
  }
  if (ctx.macro.confidenceMultiplier > 1) {
    throw new DecisionContextError('macro.confidenceMultiplier', 'confidenceMultiplier must be <= 1');
  }
  
  // macro.blocks is required
  if (!ctx.macro.blocks) {
    throw new DecisionContextError('macro.blocks', 'blocks array is REQUIRED');
  }
  
  // timestamp is required
  if (!ctx.timestamp) {
    throw new DecisionContextError('timestamp', 'timestamp is REQUIRED');
  }
  
  // symbol is required
  if (!ctx.symbol) {
    throw new DecisionContextError('symbol', 'symbol is REQUIRED');
  }
}

/**
 * Validate that VerdictWithContext is complete
 */
export function validateVerdictWithContext(verdict: Partial<VerdictWithContext>): asserts verdict is VerdictWithContext {
  // Basic fields
  if (!verdict.decision) {
    throw new DecisionContextError('decision', 'decision is REQUIRED');
  }
  if (verdict.confidence === undefined) {
    throw new DecisionContextError('confidence', 'confidence is REQUIRED');
  }
  if (!verdict.strength) {
    throw new DecisionContextError('strength', 'strength is REQUIRED');
  }
  if (!verdict.direction) {
    throw new DecisionContextError('direction', 'direction is REQUIRED');
  }
  
  // Context must be valid
  if (!verdict.context) {
    throw new DecisionContextError('context', 'context is REQUIRED');
  }
  validateDecisionContext(verdict.context);
  
  // Invariants must be present
  if (!verdict.invariants) {
    throw new DecisionContextError('invariants', 'invariants is REQUIRED');
  }
  
  // Explain must be present
  if (!verdict.explain) {
    throw new DecisionContextError('explain', 'explain is REQUIRED');
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

/**
 * Create a default (safe) DecisionContext when macro is unavailable
 */
export function createDefaultDecisionContext(symbol: string): DecisionContext {
  return {
    macro: {
      regime: 'NEUTRAL',
      riskLevel: 'MEDIUM',
      blocks: [],
      confidenceMultiplier: 0.7, // Conservative default
      flags: ['NO_MACRO_DATA'],
    },
    timestamp: Date.now(),
    dataMode: 'MOCK',
    symbol,
  };
}

/**
 * Create DecisionContext from macro intel response
 */
export function createDecisionContextFromMacro(
  symbol: string,
  macroIntel: {
    regime: string;
    riskLevel: string;
    confidenceMultiplier: number;
    flags?: string[];
    fearGreed?: number;
    btcDominance?: number;
    stableDominance?: number;
    blockStrongActions?: boolean;
  },
  dataMode: 'LIVE' | 'MOCK' | 'REPLAY' = 'LIVE'
): DecisionContext {
  // Determine blocked actions
  const blocks: DecisionAction[] = [];
  
  if (macroIntel.blockStrongActions) {
    // STRONG blocked = AVOID for aggressive actions
  }
  
  if (macroIntel.regime === 'FULL_RISK_OFF') {
    blocks.push('BUY', 'SELL');
  }
  
  return {
    macro: {
      regime: macroIntel.regime as MarketRegimeId,
      riskLevel: macroIntel.riskLevel as RiskLevel,
      blocks,
      confidenceMultiplier: Math.min(macroIntel.confidenceMultiplier, 1),
      flags: macroIntel.flags,
      fearGreed: macroIntel.fearGreed,
      btcDominance: macroIntel.btcDominance,
      stableDominance: macroIntel.stableDominance,
    },
    timestamp: Date.now(),
    dataMode,
    symbol,
  };
}

console.log('[Meta-Brain] Decision context contract loaded');
