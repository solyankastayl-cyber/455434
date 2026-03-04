/**
 * C3 — Meta-Brain v2 Contracts
 * =============================
 * 
 * CANONICAL CONTRACTS — LOCKED v1
 * 
 * Meta-Brain is NOT an analyzer.
 * Meta-Brain is an ARBITER of layer conclusions.
 * 
 * It answers ONE question:
 * "Can we trust the market direction right now — and how much?"
 * 
 * INVARIANTS:
 * - NO ML
 * - NO predictions
 * - NO confidence upgrades
 * - ONLY deterministic rules
 * - FULL explainability via ReasonTree
 */

// ═══════════════════════════════════════════════════════════════
// INPUT CONTRACTS (from other layers)
// ═══════════════════════════════════════════════════════════════

export type VerdictDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type ValidationStatus = 'CONFIRMS' | 'CONTRADICTS' | 'NO_DATA';
export type MarketReadiness = 'READY' | 'DEGRADED';
export type WhaleRisk = 'LOW' | 'MID' | 'HIGH';

/**
 * Sentiment Layer Input
 */
export interface SentimentInput {
  direction: VerdictDirection;
  confidence: number;  // 0..1
  drivers?: string[];
  source?: string;
}

/**
 * Exchange Layer Input
 */
export interface ExchangeInput {
  direction: VerdictDirection;
  confidence: number;  // 0..1
  readiness: MarketReadiness;
  whaleRisk?: WhaleRisk;
  whaleGuardTriggered?: boolean;
  drivers?: string[];
}

/**
 * Validation Layer Input (C2.2)
 */
export interface ValidationInput {
  status: ValidationStatus;
  strength?: number;  // 0..1, only if status != NO_DATA
  missing?: string[];
}

/**
 * Complete context for Meta-Brain decision
 */
export interface MetaBrainV2Context {
  symbol: string;
  t0: number;
  sentiment: SentimentInput;
  exchange: ExchangeInput;
  validation: ValidationInput;
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT CONTRACTS
// ═══════════════════════════════════════════════════════════════

/**
 * Final verdict types (6 states)
 */
export type FinalVerdict = 
  | 'STRONG_BULLISH'
  | 'WEAK_BULLISH'
  | 'NEUTRAL'
  | 'WEAK_BEARISH'
  | 'STRONG_BEARISH'
  | 'INCONCLUSIVE';

/**
 * Alignment type between Sentiment and Exchange
 */
export type AlignmentType = 'ALIGNED' | 'PARTIAL' | 'CONFLICT';

/**
 * Reason node for explainability
 */
export interface ReasonNode {
  layer: 'sentiment' | 'exchange' | 'validation' | 'matrix' | 'guard';
  verdict?: string;
  status?: string;
  confidenceImpact: number;  // + or -
  explanation: string;
}

/**
 * Guard application result
 */
export interface GuardResult {
  guardName: string;
  triggered: boolean;
  confidenceDelta: number;
  verdictChange?: string;
  reason: string;
}

/**
 * Debug information for transparency
 */
export interface MetaBrainDebug {
  alignment: AlignmentType;
  baseConfidence: number;
  validationMultiplier: number;
  confAfterValidation: number;
  matrixRuleId: string;
  matrixOutput: FinalVerdict;
  guardsApplied: GuardResult[];
}

/**
 * Final Meta-Brain decision (immutable once created)
 */
export interface MetaBrainV2Decision {
  symbol: string;
  t0: number;
  
  finalVerdict: FinalVerdict;
  finalConfidence: number;  // 0..1
  
  reasonTree: ReasonNode[];
  debug: MetaBrainDebug;
  
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// MATRIX CONTRACTS
// ═══════════════════════════════════════════════════════════════

/**
 * Validation multipliers (LOCKED v1)
 */
export const VALIDATION_MULTIPLIERS: Record<ValidationStatus, number> = {
  CONFIRMS: 1.0,
  NO_DATA: 0.7,
  CONTRADICTS: 0.4,
} as const;

/**
 * Thresholds (LOCKED v1)
 */
export const THRESHOLDS = {
  STRONG_CONFIDENCE: 0.65,
  WEAK_MIN_CONFIDENCE: 0.55,
  MIN_USABLE_CONFIDENCE: 0.4,
} as const;

/**
 * Decision matrix rule
 */
export interface MatrixRule {
  id: string;
  alignment: AlignmentType;
  validation: ValidationStatus;
  output: FinalVerdict;
  conditions?: {
    minConfidence?: number;
    readinessRequired?: MarketReadiness;
  };
  description: string;
}

console.log('[C3] Meta-Brain v2 Contracts loaded');
