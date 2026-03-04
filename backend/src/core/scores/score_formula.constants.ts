/**
 * Score Formula Constants
 * 
 * SINGLE SOURCE OF TRUTH for score weights.
 * Used by: build_scores.job.ts, score_explain.service.ts
 * 
 * Version tracking ensures explain consistency with calculation.
 */

/**
 * Formula version - increment when weights change
 */
export const SCORE_FORMULA_VERSION = '1.0.0';

/**
 * Composite score weights
 * Formula: BS*0.25 + IS*0.25 + CS*0.20 + INF*0.20 - RS*0.20 + 20
 */
export const SCORE_WEIGHTS = {
  behavior: 0.25,
  intensity: 0.25,
  consistency: 0.20,
  influence: 0.20,
  risk: -0.20,  // Negative because risk reduces score
  riskOffset: 20,  // Added to offset risk penalty
} as const;

/**
 * Tier thresholds
 */
export const TIER_THRESHOLDS = {
  green: 80,   // >= 80
  yellow: 60,  // >= 60
  orange: 40,  // >= 40
  red: 0,      // < 40
} as const;

/**
 * Strategy signal severity weights (from strategy_signals.model.ts)
 */
export const STRATEGY_SEVERITY_WEIGHTS = {
  intensity: 0.45,
  influence: 0.35,
  behavior: 0.20,
  risk: -0.30,
  rareStrategyBonus: 10,
  washOperatorPenalty: -15,
} as const;

/**
 * Strategy detection thresholds
 */
export const STRATEGY_THRESHOLDS = {
  detected: {
    minConfidence: 0.65,
    minStability: 0.55,
  },
  confirmed: {
    minConfidence: 0.75,
    minStability: 0.70,
  },
  shift: {
    confidenceDelta: 0.15,
  },
  phaseChange: {
    minStability: 0.6,
    dominanceThreshold: 0.2,  // accumulation > distribution + 0.2
  },
  spike: {
    threshold: 20,  // 20 point jump
  },
} as const;

/**
 * Dedup intervals (hours)
 */
export const SIGNAL_DEDUP_HOURS = {
  strategy_detected: 24,
  strategy_confirmed: 48,
  strategy_shift: 12,
  strategy_phase_change: 12,
  strategy_intensity_spike: 6,
  strategy_risk_spike: 6,
  strategy_influence_jump: 12,
} as const;

/**
 * Rare strategies (premium access only)
 */
export const RARE_STRATEGIES = [
  'rotation_trader',
  'distribution_whale',
  'accumulation_sniper',
] as const;
