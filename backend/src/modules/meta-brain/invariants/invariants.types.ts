/**
 * META-BRAIN INVARIANTS — TYPE DEFINITIONS
 * =========================================
 * 
 * HARD INVARIANTS: Violation = AVOID (system refuses to act)
 * SOFT INVARIANTS: Violation = Penalty (confidence reduction)
 * 
 * @sealed v1.0
 */

// ═══════════════════════════════════════════════════════════════
// INVARIANT SEVERITY LEVELS
// ═══════════════════════════════════════════════════════════════

export enum InvariantLevel {
  /** Hard violation = forced AVOID decision */
  HARD = 'HARD',
  /** Soft violation = confidence penalty */
  SOFT = 'SOFT',
}

// ═══════════════════════════════════════════════════════════════
// INVARIANT SOURCES
// ═══════════════════════════════════════════════════════════════

export type InvariantSource = 'MACRO' | 'ML' | 'LABS' | 'SYSTEM';

// ═══════════════════════════════════════════════════════════════
// INVARIANT VIOLATION
// ═══════════════════════════════════════════════════════════════

export interface InvariantViolation {
  /** Unique invariant ID */
  id: string;
  
  /** Severity level */
  level: InvariantLevel;
  
  /** Human-readable reason */
  reason: string;
  
  /** Which module triggered this */
  source: InvariantSource;
  
  /** Timestamp of violation */
  timestamp: number;
  
  /** Context data for debugging */
  context?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════
// INVARIANT DEFINITION
// ═══════════════════════════════════════════════════════════════

export interface InvariantDefinition<T = any> {
  /** Unique ID */
  id: string;
  
  /** Severity level */
  level: InvariantLevel;
  
  /** Source module */
  source: InvariantSource;
  
  /** Human-readable description */
  description: string;
  
  /** Rule function: returns true if invariant holds */
  rule: (ctx: T) => boolean;
  
  /** Penalty for soft violations (0..1 multiplier) */
  penalty?: number;
}

// ═══════════════════════════════════════════════════════════════
// INVARIANT CHECK CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface InvariantCheckContext {
  // Base verdict
  baseAction: 'BUY' | 'SELL' | 'AVOID';
  baseConfidence: number;
  baseStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  
  // Final verdict (after modifiers)
  finalAction: 'BUY' | 'SELL' | 'AVOID';
  finalConfidence: number;
  finalStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  
  // Macro context
  macroRegime: string;
  macroRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  macroPenalty: number;  // confidenceMultiplier (should be <= 1)
  macroFlags: string[];
  
  // ML modifiers
  mlApplied: boolean;
  mlModifier: number;  // should be <= 1 (can only lower confidence)
  mlAction?: 'BUY' | 'SELL' | 'AVOID';
  
  // Labs influence
  labsInfluence: number;  // should be 0 (Labs are READ-ONLY)
  labsConflict: boolean;
  
  // System state
  hasConflict: boolean;
  decision: 'BUY' | 'SELL' | 'AVOID';
}

// ═══════════════════════════════════════════════════════════════
// ENFORCER RESULT
// ═══════════════════════════════════════════════════════════════

export interface EnforcerResult {
  /** All detected violations */
  violations: InvariantViolation[];
  
  /** Was any HARD invariant violated? */
  hasHardViolation: boolean;
  
  /** Forced decision if HARD violation */
  forceDecision?: 'AVOID';
  
  /** Applied confidence penalty (product of all soft penalties) */
  confidencePenalty: number;
  
  /** Final confidence after penalties */
  adjustedConfidence: number;
  
  /** System should proceed? */
  proceed: boolean;
  
  /** Audit trail */
  audit: {
    checkedAt: number;
    invariantsChecked: number;
    passed: number;
    softViolations: number;
    hardViolations: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// INVARIANT ERROR
// ═══════════════════════════════════════════════════════════════

export class InvariantViolationError extends Error {
  public readonly violations: InvariantViolation[];
  public readonly forceDecision: 'AVOID';
  
  constructor(violations: InvariantViolation[]) {
    super(`Invariant violation: ${violations.map(v => v.id).join(', ')}`);
    this.name = 'InvariantViolationError';
    this.violations = violations;
    this.forceDecision = 'AVOID';
  }
}

console.log('[Meta-Brain] Invariant types loaded');
