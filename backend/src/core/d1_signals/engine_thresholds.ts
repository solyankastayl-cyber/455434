/**
 * ETAP 6.4 — Engine Thresholds Configuration
 * 
 * Window-specific thresholds for each rule.
 * Pure rules, NO ML, NO price predictions.
 */

export type ThresholdWindow = '24h' | '7d' | '30d';

export interface RuleThresholds {
  // NEW_CORRIDOR
  NEW_CORRIDOR: {
    minDensity: number;
    minConfidence: 'low' | 'medium' | 'high';
    minWeight: number;
    coverageRequired: number;
    highDensity: number;         // Threshold for HIGH severity
  };
  
  // DENSITY_SPIKE
  DENSITY_SPIKE: {
    minPrevDensity: number;
    minCurrentDensity: number;
    minSpikeRatio: number;       // e.g., 0.7 = +70%
    coverageRequired: number;
    highSpikeRatio: number;      // Threshold for HIGH severity
    highMinDensity: number;
  };
  
  // DIRECTION_IMBALANCE
  DIRECTION_IMBALANCE: {
    minTotalFlowUsd: number;
    minNetFlowUsd: number;
    minImbalanceRatio: number;
    coverageRequired: number;
    highNetFlowUsd: number;      // Threshold for HIGH severity
    highImbalanceRatio: number;
  };
  
  // ACTOR_REGIME_CHANGE
  ACTOR_REGIME_CHANGE: {
    minTxDeltaPct: number;
    minActiveDays: number;
    coverageRequired: number;
  };
  
  // NEW_BRIDGE
  NEW_BRIDGE: {
    minConfidence: 'low' | 'medium' | 'high';
    minTemporalSync: number;
    coverageRequired: number;
  };
}

export const ENGINE_THRESHOLDS: Record<ThresholdWindow, RuleThresholds> = {
  '24h': {
    NEW_CORRIDOR: {
      minDensity: 1,           // Lowered for testing
      minConfidence: 'low',    // Lowered for testing
      minWeight: 0.01,         // Lowered for testing
      coverageRequired: 0.30,
      highDensity: 3,
    },
    DENSITY_SPIKE: {
      minPrevDensity: 1,
      minCurrentDensity: 2,
      minSpikeRatio: 0.30,     // Lowered for testing
      coverageRequired: 0.30,
      highSpikeRatio: 0.8,
      highMinDensity: 4,
    },
    DIRECTION_IMBALANCE: {
      minTotalFlowUsd: 10_000,      // Lowered for testing
      minNetFlowUsd: 5_000,         // Lowered for testing
      minImbalanceRatio: 0.20,      // Lowered for testing
      coverageRequired: 0.30,
      highNetFlowUsd: 100_000,
      highImbalanceRatio: 0.40,
    },
    ACTOR_REGIME_CHANGE: {
      minTxDeltaPct: 0.50,
      minActiveDays: 1,
      coverageRequired: 0.30,
    },
    NEW_BRIDGE: {
      minConfidence: 'medium',
      minTemporalSync: 0.40,
      coverageRequired: 0.30,
    },
  },
  
  '7d': {
    NEW_CORRIDOR: {
      minDensity: 6,
      minConfidence: 'medium',
      minWeight: 0.55,
      coverageRequired: 0.40,
      highDensity: 12,
    },
    DENSITY_SPIKE: {
      minPrevDensity: 4,
      minCurrentDensity: 8,
      minSpikeRatio: 0.50,
      coverageRequired: 0.40,
      highSpikeRatio: 1.0,
      highMinDensity: 14,
    },
    DIRECTION_IMBALANCE: {
      minTotalFlowUsd: 5_000_000,
      minNetFlowUsd: 2_000_000,
      minImbalanceRatio: 0.35,
      coverageRequired: 0.40,
      highNetFlowUsd: 10_000_000,
      highImbalanceRatio: 0.50,
    },
    ACTOR_REGIME_CHANGE: {
      minTxDeltaPct: 0.30,
      minActiveDays: 3,
      coverageRequired: 0.40,
    },
    NEW_BRIDGE: {
      minConfidence: 'medium',
      minTemporalSync: 0.55,
      coverageRequired: 0.40,
    },
  },
  
  '30d': {
    // 30d uses same as 7d for now (future enhancement)
    NEW_CORRIDOR: {
      minDensity: 8,
      minConfidence: 'medium',
      minWeight: 0.60,
      coverageRequired: 0.45,
      highDensity: 15,
    },
    DENSITY_SPIKE: {
      minPrevDensity: 6,
      minCurrentDensity: 10,
      minSpikeRatio: 0.40,
      coverageRequired: 0.45,
      highSpikeRatio: 0.80,
      highMinDensity: 18,
    },
    DIRECTION_IMBALANCE: {
      minTotalFlowUsd: 10_000_000,
      minNetFlowUsd: 5_000_000,
      minImbalanceRatio: 0.40,
      coverageRequired: 0.45,
      highNetFlowUsd: 20_000_000,
      highImbalanceRatio: 0.55,
    },
    ACTOR_REGIME_CHANGE: {
      minTxDeltaPct: 0.25,
      minActiveDays: 5,
      coverageRequired: 0.45,
    },
    NEW_BRIDGE: {
      minConfidence: 'medium',
      minTemporalSync: 0.60,
      coverageRequired: 0.45,
    },
  },
};

// Rule version for tracking
export const RULE_VERSION = '2.0.0';

// General limits
export const ENGINE_LIMITS = {
  MAX_SIGNALS_PER_RUN: 50,
  AUTO_RESOLVE_AFTER_RUNS: 1,  // Resolve if not re-triggered in N runs
};
