/**
 * Evaluation Rules (ETAP 5.4)
 * 
 * Production-grade criteria for candidate model promotion.
 * 
 * Context: BUY-heavy market where:
 * - False Positive (bad BUY) is more expensive than False Negative (missed opportunity)
 * - Delayed effects are acceptable (7d-30d horizons)
 * - Precision > Recall priority
 */

export interface EvaluationRules {
  // Absolute gates - must pass
  absolute: {
    minEvalSamples: number;
    precision: {
      '7d': number;
      '30d': number;
    };
    prAuc: {
      '7d': number;
      '30d': number;
    };
    calibrationErrorMax: number;
  };
  
  // Relative gates - must beat baseline
  relative: {
    precisionLift: number;     // vs baseline
    prAucLift: number;         // vs baseline
    liftVsRules: number;       // overall lift multiplier
  };
  
  // Risk gates - auto-block
  risk: {
    fpIncreaseMax: number;          // FP rate increase limit
    confidenceCollapseMax: number;  // Calibration degradation limit
    drawdownAfterBuyMax: number;    // Max acceptable drawdown
  };
  
  // Drift gates
  drift: {
    blockLevels: string[];     // Block if drift in these levels
  };
  
  // Promotion policy
  promotion: {
    requireBetterThan: string[];   // Must beat these baselines
    blockOnDrift: string[];        // Drift levels that block
    maxPromotionsPerMonth: number; // Rate limit
  };
}

/**
 * Production rules v1 - Conservative for BUY-heavy system
 */
export const EVALUATION_RULES: EvaluationRules = {
  // ========== ABSOLUTE GATES ==========
  absolute: {
    // Minimum eval samples (otherwise too noisy)
    minEvalSamples: 60,
    
    // Precision thresholds
    // BUY can't be a lottery - need 60%+ success rate
    precision: {
      '7d': 0.60,   // 60% of BUY predictions must be correct (7d)
      '30d': 0.58,  // Slightly lower for longer horizon (more noise)
    },
    
    // PR-AUC thresholds
    // For imbalanced classes (BUY is rare)
    prAuc: {
      '7d': 0.55,   // Must be better than random (0.5)
      '30d': 0.53,  // Slightly lower for 30d
    },
    
    // Calibration error max (ECE or Brier)
    // Confidence must be well-calibrated
    calibrationErrorMax: 0.10, // 10% max error
  },
  
  // ========== RELATIVE GATES ==========
  relative: {
    // Precision lift vs baseline
    // Must be at least 5% better
    precisionLift: 0.05, // +5%
    
    // PR-AUC lift vs baseline
    // Must be at least 3% better
    prAucLift: 0.03, // +3%
    
    // Overall lift vs rules engine
    // Must provide 10%+ value
    liftVsRules: 1.10, // 1.10 = +10%
  },
  
  // ========== RISK GATES ==========
  risk: {
    // False Positive increase limit
    // Critical: FP (bad BUY) is expensive
    fpIncreaseMax: 0.10, // Max +10% FP rate increase vs baseline
    
    // Confidence collapse detection
    // If calibration degrades significantly, block
    confidenceCollapseMax: 0.08, // Max +8% calibration error increase
    
    // Drawdown after BUY
    // If BUY leads to significant losses, block
    drawdownAfterBuyMax: 0.12, // Max 12% average drawdown
  },
  
  // ========== DRIFT GATES ==========
  drift: {
    // Block promotion if drift at these levels
    blockLevels: ['HIGH', 'CRITICAL'],
  },
  
  // ========== PROMOTION POLICY ==========
  promotion: {
    // Candidate must be better than ALL of these
    requireBetterThan: ['RULES', 'ACTIVE_ML'],
    
    // Block promotion if drift at these levels
    blockOnDrift: ['HIGH', 'CRITICAL'],
    
    // Rate limit: max 2 promotions per month
    // Prevents too frequent changes
    maxPromotionsPerMonth: 2,
  },
};

/**
 * Get evaluation rules (allows for future config overrides)
 */
export function getEvaluationRules(): EvaluationRules {
  // Future: could load from config or ENV overrides
  return EVALUATION_RULES;
}

/**
 * Why these numbers?
 * 
 * PRECISION ≥ 0.60
 * - BUY decision is expensive (capital allocation)
 * - Need 60%+ success rate to justify BUY
 * - Below 60% = gambling
 * 
 * PR-AUC ≥ 0.55
 * - BUY is rare event (imbalanced classes)
 * - PR-AUC better than ROC-AUC for imbalanced
 * - 0.55 is meaningful improvement over 0.5 (random)
 * 
 * PRECISION LIFT ≥ +5%
 * - Need significant improvement to justify model switch
 * - Below +5% = not worth the operational risk
 * 
 * FP INCREASE ≤ +10%
 * - False Positives (bad BUY) are most expensive
 * - Asymmetric risk: FP > FN
 * - Strict limit on FP growth
 * 
 * CALIBRATION ERROR ≤ 0.10
 * - Confidence must be reliable
 * - Used for position sizing and risk management
 * - Poor calibration = dangerous confidence scores
 * 
 * DRIFT HIGH/CRITICAL → BLOCK
 * - High drift = market regime changed
 * - Model trained on old regime may not work
 * - Safety-first: block until drift stabilizes
 * 
 * MAX 2 PROMOTIONS/MONTH
 * - Prevents model thrashing
 * - Allows time to observe each model in production
 * - Reduces operational complexity
 */

/**
 * Helper: Check if candidate beats threshold
 */
export function checkAbsoluteGate(
  value: number,
  threshold: number,
  higherIsBetter: boolean = true
): {
  passed: boolean;
  value: number;
  threshold: number;
  delta: number;
} {
  const passed = higherIsBetter
    ? value >= threshold
    : value <= threshold;
  
  const delta = higherIsBetter
    ? value - threshold
    : threshold - value;
  
  return {
    passed,
    value,
    threshold,
    delta,
  };
}

/**
 * Helper: Check if candidate beats baseline by required margin
 */
export function checkRelativeGate(
  candidateValue: number,
  baselineValue: number,
  requiredLift: number,
  higherIsBetter: boolean = true
): {
  passed: boolean;
  candidateValue: number;
  baselineValue: number;
  actualLift: number;
  requiredLift: number;
} {
  const actualLift = candidateValue - baselineValue;
  const passed = higherIsBetter
    ? actualLift >= requiredLift
    : actualLift <= -requiredLift;
  
  return {
    passed,
    candidateValue,
    baselineValue,
    actualLift,
    requiredLift,
  };
}
