/**
 * Signal Reweighting v1.1 Types
 * 
 * Adaptive calibration of expert signal system based on outcomes.
 * NOT ML - this is explainable, rollbackable, audit-friendly adjustment.
 */

/**
 * Signal types in the system
 */
export type SignalType = 
  | 'DEX_FLOW'
  | 'WHALE_TRANSFER' 
  | 'CONFLICT'
  | 'CORRIDOR_SPIKE'
  | 'BEHAVIOR_SHIFT';

/**
 * Signal components that can be reweighted
 */
export type SignalComponent = 
  | 'evidence'
  | 'direction'
  | 'risk'
  | 'confidence';

/**
 * Outcome verdicts that drive reweighting
 */
export type OutcomeVerdict = 
  | 'TRUE_POSITIVE'
  | 'FALSE_POSITIVE'
  | 'DELAYED_TRUE'
  | 'MISSED'
  | 'TRUE_NEGATIVE';

/**
 * Reweighting policy - how to adjust based on outcome
 */
export interface ReweightingPolicy {
  verdict: OutcomeVerdict;
  action: 'strengthen' | 'weaken' | 'none';
  multiplier: number; // Applied to learning rate
}

/**
 * Default reweighting policies
 */
export const REWEIGHTING_POLICIES: Record<OutcomeVerdict, ReweightingPolicy> = {
  TRUE_POSITIVE: {
    verdict: 'TRUE_POSITIVE',
    action: 'strengthen',
    multiplier: 1.0,
  },
  DELAYED_TRUE: {
    verdict: 'DELAYED_TRUE',
    action: 'strengthen',
    multiplier: 0.5, // Weaker reinforcement
  },
  FALSE_POSITIVE: {
    verdict: 'FALSE_POSITIVE',
    action: 'weaken',
    multiplier: 1.0,
  },
  MISSED: {
    verdict: 'MISSED',
    action: 'strengthen',
    multiplier: 0.8, // Only if BUY wasn't made
  },
  TRUE_NEGATIVE: {
    verdict: 'TRUE_NEGATIVE',
    action: 'none',
    multiplier: 0,
  },
};

/**
 * Signal effectiveness statistics
 */
export interface SignalEffectiveness {
  signalType: SignalType;
  component?: SignalComponent;
  
  // Sample statistics
  totalSamples: number;
  truePositives: number;
  falsePositives: number;
  delayedTrue: number;
  missed: number;
  
  // Derived metrics
  precision: number; // TP / (TP + FP)
  recall: number; // TP / (TP + FN)
  f1Score: number;
  
  // Confidence
  sampleStability: number; // 0-1, based on sample count
  driftLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  
  // Current weights
  currentWeight: number;
  baseWeight: number;
  drift: number; // currentWeight - baseWeight
  
  // Learning readiness
  readyForAdjustment: boolean;
  reasonIfNotReady?: string;
}

/**
 * Signal weight structure (two-level)
 */
export interface SignalWeight {
  signalType: SignalType;
  
  // Type-level weight (overall importance of this signal type)
  typeWeight: {
    base: number;
    current: number;
    min: number;
    max: number;
  };
  
  // Component weights (fine-tuning within signal)
  components: {
    evidence: {
      base: number;
      current: number;
      min: number;
      max: number;
    };
    direction: {
      base: number;
      current: number;
      min: number;
      max: number;
    };
    risk: {
      base: number;
      current: number;
      min: number;
      max: number;
    };
    confidence: {
      base: number;
      current: number;
      min: number;
      max: number;
    };
  };
}

/**
 * Adaptive learning rate configuration
 */
export interface AdaptiveLearningRate {
  baseLR: number; // Base learning rate (from env)
  confidenceFactor: number; // Multiplier based on drift level
  sampleStability: number; // Sigmoid based on sample count
  effectiveLR: number; // Final LR = baseLR * confidenceFactor * sampleStability
}

/**
 * Reweighting adjustment result
 */
export interface ReweightingAdjustment {
  signalType: SignalType;
  component?: SignalComponent;
  
  oldWeight: number;
  newWeight: number;
  delta: number;
  
  policy: ReweightingPolicy;
  learningRate: AdaptiveLearningRate;
  
  hitBoundary: boolean;
  frozen: boolean;
  
  reason: string;
  timestamp: Date;
}

/**
 * Calculate sample stability (sigmoid function)
 * Returns 0-1 based on how many samples we have
 */
export function calculateSampleStability(sampleCount: number): number {
  // Sigmoid: 1 / (1 + exp(-k * (x - x0)))
  // x0 = 200 (inflection point)
  // k = 0.01 (steepness)
  const x0 = 200;
  const k = 0.01;
  return 1 / (1 + Math.exp(-k * (sampleCount - x0)));
}

/**
 * Get confidence factor based on drift level
 */
export function getConfidenceFactor(driftLevel: string): number {
  switch (driftLevel) {
    case 'LOW':
      return 1.0;
    case 'MEDIUM':
      return 0.7;
    case 'HIGH':
      return 0.3;
    case 'CRITICAL':
      return 0.0; // Frozen
    default:
      return 1.0;
  }
}

/**
 * Calculate effective learning rate
 */
export function calculateEffectiveLR(
  baseLR: number,
  driftLevel: string,
  sampleCount: number
): AdaptiveLearningRate {
  const confidenceFactor = getConfidenceFactor(driftLevel);
  const sampleStability = calculateSampleStability(sampleCount);
  const effectiveLR = baseLR * confidenceFactor * sampleStability;
  
  return {
    baseLR,
    confidenceFactor,
    sampleStability,
    effectiveLR,
  };
}

/**
 * Base weights for signal types (from current system)
 */
export const BASE_SIGNAL_TYPE_WEIGHTS: Record<SignalType, number> = {
  DEX_FLOW: 0.35,
  WHALE_TRANSFER: 0.30,
  CONFLICT: 0.20,
  CORRIDOR_SPIKE: 0.10,
  BEHAVIOR_SHIFT: 0.05,
};

/**
 * Base component weights (within each signal)
 */
export const BASE_COMPONENT_WEIGHTS: Record<SignalComponent, number> = {
  evidence: 0.30,
  direction: 0.35,
  risk: -0.20, // Negative weight (penalty)
  confidence: 0.15,
};
