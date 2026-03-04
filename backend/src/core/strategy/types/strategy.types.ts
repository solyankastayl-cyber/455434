/**
 * S1.1 - Strategy Definition Types
 * 
 * Defines the structure for declarative strategy rules.
 * Strategies interpret Signal Drivers A-F to produce actionable verdicts.
 * 
 * NO ML terminology - pure business logic.
 */

// ==========================================
// VERDICT TYPES
// ==========================================

/**
 * Strategy verdict - what action to take
 */
export type StrategyVerdict =
  | 'ACCUMULATE'    // Build position gradually
  | 'EXIT'          // Reduce or close position
  | 'WAIT'          // Hold, monitor for changes
  | 'AVOID'         // Do not enter
  | 'HIGH_RISK';    // Speculative opportunity

/**
 * Risk level for the strategy
 */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Time horizon
 */
export type TimeHorizon = 'SHORT' | 'MEDIUM' | 'LONG';

// ==========================================
// CONDITION TYPES
// ==========================================

/**
 * Driver state condition
 */
export interface DriverCondition {
  driver: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  state: string | string[];  // Match one or more states
  strength?: 'HIGH' | 'MEDIUM' | 'LOW' | ('HIGH' | 'MEDIUM' | 'LOW')[];
}

/**
 * Quality condition
 */
export interface QualityCondition {
  quality: ('HIGH' | 'MEDIUM' | 'LOW')[];
}

/**
 * Rule condition - when to apply the rule
 */
export interface StrategyCondition {
  /** Required quality levels */
  quality?: ('HIGH' | 'MEDIUM' | 'LOW')[];
  
  /** Required driver states (ALL must match) */
  drivers?: DriverCondition[];
  
  /** At least N drivers must be bullish */
  minBullishDrivers?: number;
  
  /** At least N drivers must be bearish */
  minBearishDrivers?: number;
  
  /** Exclude if any driver in state */
  excludeStates?: { driver: string; state: string }[];
}

// ==========================================
// RULE TYPES
// ==========================================

/**
 * Strategy rule - condition → outcome
 */
export interface StrategyRule {
  /** Unique rule ID */
  id: string;
  
  /** Rule priority (higher = checked first) */
  priority: number;
  
  /** When to apply this rule */
  when: StrategyCondition;
  
  /** What to return if matched */
  then: {
    verdict: StrategyVerdict;
    risk: RiskLevel;
    horizon: TimeHorizon;
    reasons: string[];
  };
}

// ==========================================
// STRATEGY DEFINITION
// ==========================================

/**
 * Complete strategy definition
 */
export interface StrategyDefinition {
  /** Unique strategy ID */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Short description */
  description: string;
  
  /** Version for tracking */
  version: string;
  
  /** Which networks this applies to */
  networks: string[];
  
  /** Strategy rules (evaluated in priority order) */
  rules: StrategyRule[];
  
  /** Default outcome if no rules match */
  defaultOutcome: {
    verdict: StrategyVerdict;
    risk: RiskLevel;
    horizon: TimeHorizon;
    reasons: string[];
  };
  
  /** Whether strategy is active */
  active: boolean;
  
  /** Strategy metadata */
  meta?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    tags?: string[];
  };
}

// ==========================================
// EVALUATION TYPES
// ==========================================

/**
 * Input for strategy evaluation
 */
export interface StrategyEvaluationInput {
  network: string;
  quality: 'HIGH' | 'MEDIUM' | 'LOW';
  drivers: Record<string, { state: string; strength: 'HIGH' | 'MEDIUM' | 'LOW' }>;
}

/**
 * Strategy evaluation result
 */
export interface StrategyEvaluationResult {
  /** Strategy that produced this result */
  strategyId: string;
  strategyName: string;
  
  /** The verdict */
  verdict: StrategyVerdict;
  
  /** Risk assessment */
  risk: RiskLevel;
  
  /** Time horizon */
  horizon: TimeHorizon;
  
  /** Human-readable explanation */
  reasons: string[];
  
  /** Which rule matched (if any) */
  matchedRule?: string;
  
  /** Confidence in the verdict */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  
  /** Timestamp */
  timestamp: number;
}

/**
 * Multi-strategy evaluation result
 */
export interface MultiStrategyResult {
  network: string;
  strategies: StrategyEvaluationResult[];
  primaryVerdict: StrategyVerdict;
  timestamp: number;
}
