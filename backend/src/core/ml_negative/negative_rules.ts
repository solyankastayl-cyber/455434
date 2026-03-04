/**
 * Negative Sample Rules
 * 
 * EPIC 8: Thresholds and windows for 4 negative types
 * 
 * (N1) Structural: Pattern exists, no price reaction
 * (N2) Noise: Flow spike with no continuation
 * (N3) Exhaustion: Late entry after run-up
 * (N4) Reversal: Accumulation then distribution
 */

import type { NegativeType } from './negative.types.js';

// ============================================
// (N1) STRUCTURAL NEGATIVE
// Signal exists → no price reaction
// ============================================
export const STRUCTURAL_RULES = {
  // Minimum signal strength to consider
  minSignalStrength: 0.3,
  
  // Price reaction thresholds (must be BELOW these for negative)
  futureReturn24hMax: 0.01,  // < +1%
  futureReturn7dMax: 0.03,   // < +3%
  
  // Signal must have been "real" (not noise)
  requireSmartMoney: false,
  requireAccumulation: false,
};

// ============================================
// (N2) NOISE NEGATIVE
// Flow spike → no continuation
// ============================================
export const NOISE_RULES = {
  // Flow spike detection
  minDeltaNetFlow24h: 10000, // Absolute minimum flow change
  
  // Continuation ratio (3d should be < 25% of 24h spike)
  maxContinuationRatio: 0.25,
  
  // Low consistency indicates noise
  maxConsistency: 0.35,
  
  // Regime should be NOISE
  expectedRegimes: ['NOISE', 'FADING'],
};

// ============================================
// (N3) EXHAUSTION NEGATIVE
// Late entry after run-up
// ============================================
export const EXHAUSTION_RULES = {
  // Past run-up detection
  minPastReturn7d: 0.10,  // > +10% already happened
  
  // Future return should be weak
  maxFutureReturn7d: 0.02,  // < +2%
  
  // Regime indicates late phase
  expectedRegimes: ['PEAKING', 'FADING'],
  
  // Acceleration should be negative (slowing)
  maxAcceleration: 0,
};

// ============================================
// (N4) REVERSAL NEGATIVE
// Accumulation → Distribution trap
// ============================================
export const REVERSAL_RULES = {
  // Flow reversal: was positive, now negative
  requireFlowReversal: true,
  
  // Future return should be negative
  maxFutureReturn7d: -0.05,  // < -5%
  
  // Acceleration negative (trend reversing)
  maxAcceleration: -0.01,
  
  // Consistency falling
  maxConsistency: 0.5,
};

// ============================================
// POSITIVE SAMPLE RULES
// For comparison / balance
// ============================================
export const POSITIVE_RULES = {
  // Price increase thresholds
  minFutureReturn7d: 0.05,   // > +5%
  minFutureReturn24h: 0.02,  // > +2%
  
  // MAE should be reasonable
  maxAdverseExcursion: 0.10, // < -10% drawdown
  
  // MFE should exceed MAE
  minMfeMaeRatio: 1.5,
};

// ============================================
// CLASSIFIER
// ============================================

interface ClassificationInput {
  futureReturn24h: number;
  futureReturn7d: number;
  pastReturn7d: number;
  deltaNetFlow24h: number;
  deltaNetFlow3d: number;
  consistency: number;
  acceleration: number;
  regime: string;
  signalStrength: number;
  mae: number;
  mfe: number;
}

interface ClassificationResult {
  label: 0 | 1;
  negativeType?: NegativeType;
  reason: string;
  confidence: number;
}

/**
 * Classify a sample as positive or negative (with type)
 */
export function classifySample(input: ClassificationInput): ClassificationResult {
  // First check if it's a clear positive
  if (isPositive(input)) {
    return {
      label: 1,
      reason: 'confirmed_positive',
      confidence: calculatePositiveConfidence(input),
    };
  }
  
  // Check each negative type in priority order
  
  // (N4) Reversal - most dangerous, check first
  if (isReversal(input)) {
    return {
      label: 0,
      negativeType: 'REVERSAL',
      reason: 'distribution_after_signal',
      confidence: 0.85,
    };
  }
  
  // (N3) Exhaustion - late entry
  if (isExhaustion(input)) {
    return {
      label: 0,
      negativeType: 'EXHAUSTION',
      reason: 'late_signal_exhaustion',
      confidence: 0.80,
    };
  }
  
  // (N2) Noise - isolated spike
  if (isNoise(input)) {
    return {
      label: 0,
      negativeType: 'NOISE',
      reason: 'isolated_flow_noise',
      confidence: 0.75,
    };
  }
  
  // (N1) Structural - default negative if nothing else
  if (isStructural(input)) {
    return {
      label: 0,
      negativeType: 'STRUCTURAL',
      reason: 'pattern_without_price_reaction',
      confidence: 0.70,
    };
  }
  
  // Edge case: not clearly positive or negative
  // Default to structural negative (conservative)
  return {
    label: 0,
    negativeType: 'STRUCTURAL',
    reason: 'pattern_without_price_reaction',
    confidence: 0.50,
  };
}

function isPositive(input: ClassificationInput): boolean {
  return (
    input.futureReturn7d >= POSITIVE_RULES.minFutureReturn7d &&
    input.futureReturn24h >= POSITIVE_RULES.minFutureReturn24h &&
    input.mae <= POSITIVE_RULES.maxAdverseExcursion &&
    (input.mfe / Math.max(Math.abs(input.mae), 0.001)) >= POSITIVE_RULES.minMfeMaeRatio
  );
}

function isStructural(input: ClassificationInput): boolean {
  return (
    input.signalStrength >= STRUCTURAL_RULES.minSignalStrength &&
    input.futureReturn24h < STRUCTURAL_RULES.futureReturn24hMax &&
    input.futureReturn7d < STRUCTURAL_RULES.futureReturn7dMax
  );
}

function isNoise(input: ClassificationInput): boolean {
  const continuationRatio = Math.abs(input.deltaNetFlow3d) / 
    Math.max(Math.abs(input.deltaNetFlow24h), 1);
  
  return (
    Math.abs(input.deltaNetFlow24h) > NOISE_RULES.minDeltaNetFlow24h &&
    continuationRatio < NOISE_RULES.maxContinuationRatio &&
    input.consistency < NOISE_RULES.maxConsistency &&
    NOISE_RULES.expectedRegimes.includes(input.regime)
  );
}

function isExhaustion(input: ClassificationInput): boolean {
  return (
    input.pastReturn7d > EXHAUSTION_RULES.minPastReturn7d &&
    input.futureReturn7d < EXHAUSTION_RULES.maxFutureReturn7d &&
    EXHAUSTION_RULES.expectedRegimes.includes(input.regime) &&
    input.acceleration < EXHAUSTION_RULES.maxAcceleration
  );
}

function isReversal(input: ClassificationInput): boolean {
  // Flow was positive (accumulation) but now negative or reversing
  const flowReversing = input.deltaNetFlow24h > 0 && input.deltaNetFlow3d < 0;
  
  return (
    flowReversing &&
    input.futureReturn7d < REVERSAL_RULES.maxFutureReturn7d &&
    input.acceleration < REVERSAL_RULES.maxAcceleration &&
    input.consistency < REVERSAL_RULES.maxConsistency
  );
}

function calculatePositiveConfidence(input: ClassificationInput): number {
  // Higher return = higher confidence
  const returnScore = Math.min(input.futureReturn7d / 0.10, 1.0) * 0.4;
  
  // Better MFE/MAE ratio = higher confidence
  const mfeMaeRatio = input.mfe / Math.max(Math.abs(input.mae), 0.001);
  const maeScore = Math.min(mfeMaeRatio / 3, 1.0) * 0.3;
  
  // Higher consistency = higher confidence
  const consistencyScore = input.consistency * 0.3;
  
  return Math.min(returnScore + maeScore + consistencyScore, 1.0);
}
