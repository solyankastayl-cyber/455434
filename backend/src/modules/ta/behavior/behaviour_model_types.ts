/**
 * Phase AE2: Behaviour Model Types
 * 
 * The behaviour model is a "snapshot of knowledge" about scenario performance.
 * It's used to adjust probability based on empirical data.
 */

// ═══════════════════════════════════════════════════════════════
// MODEL STRUCTURE
// ═══════════════════════════════════════════════════════════════

export type BehaviourKeyStats = {
  behaviourKey: string;
  n: number;                    // Sample size
  wins: number;
  losses: number;
  winRate: number;              // wins / (wins + losses)
  avgR: number;                 // Average R-multiple
  avgMFE: number;               // Average max favorable excursion
  avgMAE: number;               // Average max adverse excursion
  confidence: number;           // Statistical confidence (0-1)
  boost: number;                // Probability adjustment (-0.22 to +0.18)
};

export type ConditionStats = {
  patternType: string;
  condition: string;            // e.g., "volumeSpike=true"
  n: number;
  deltaWinRate: number;         // Difference from base rate
  boost: number;
  confidence: number;
};

export type BehaviourModelRules = {
  globalShrink: number;         // Bayesian shrink factor (default 0.65)
  maxBoost: number;             // Maximum positive adjustment (default 0.18)
  maxPenalty: number;           // Maximum negative adjustment (default 0.22)
  minSamples: number;           // Minimum samples for boost (default 30)
  baselineWinRate: number;      // Global baseline (default 0.55)
};

export type BehaviourModel = {
  modelId: string;
  version: number;
  builtAt: Date;
  buildDurationMs: number;
  
  rules: BehaviourModelRules;
  
  // Stats by behaviour key
  keys: BehaviourKeyStats[];
  
  // Stats by condition
  conditions: ConditionStats[];
  
  // Summary
  summary: {
    totalScenarios: number;
    uniqueKeys: number;
    uniqueConditions: number;
    avgWinRate: number;
    avgConfidence: number;
  };
};

// ═══════════════════════════════════════════════════════════════
// PROBABILITY BREAKDOWN
// ═══════════════════════════════════════════════════════════════

export type ProbabilityBreakdown = {
  textbook: number;             // Original textbook prior
  confluence: number;           // After confluence adjustment
  calibrated: number;           // After calibration
  behaviourBoost: number;       // After behaviour adjustment
  mlOverlay?: number;           // After ML (if enabled)
  final: number;                // Final probability
};

export type BehaviourExplanation = {
  modelId: string;
  behaviourKey: string;
  patternType: string;
  
  // Stats
  samples: number;
  baseWinRate: number;
  scenarioWinRate: number;
  
  // Adjustment
  rawBoost: number;
  confidence: number;
  appliedBoost: number;
  
  // Contributors
  contributors: Array<{
    name: string;
    delta: number;
    confidence: number;
  }>;
};

// ═══════════════════════════════════════════════════════════════
// DEFAULT RULES
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_BEHAVIOUR_RULES: BehaviourModelRules = {
  globalShrink: 0.65,
  maxBoost: 0.18,
  maxPenalty: 0.22,
  minSamples: 30,
  baselineWinRate: 0.55,
};
