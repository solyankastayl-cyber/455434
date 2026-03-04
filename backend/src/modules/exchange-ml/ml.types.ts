/**
 * S10.7 — Exchange ML Types
 * 
 * CONTRACTS (LOCKED)
 * 
 * ML classification of market state:
 * - USE: Market is readable, structured, suitable for decisions
 * - IGNORE: Noise, uncertainty, false moves
 * - WARNING: Dangerous environment (cascades, traps, manipulation)
 * 
 * NOT a trading signal. NOT price prediction.
 */

// ═══════════════════════════════════════════════════════════════
// ML LABEL (Target variable)
// ═══════════════════════════════════════════════════════════════

export type MLLabel = 'USE' | 'IGNORE' | 'WARNING';

// ═══════════════════════════════════════════════════════════════
// ML FEATURES (Normalized input vector)
// ═══════════════════════════════════════════════════════════════

export interface MLFeatures {
  // Regime features
  regimeConfidence: number;      // 0..1
  regimeIsExpansion: number;     // 0 or 1
  regimeIsSqueeze: number;       // 0 or 1
  regimeIsExhaustion: number;    // 0 or 1
  
  // Order Flow features
  flowBias: number;              // -1..1 (sell to buy)
  flowDominance: number;         // 0..1
  absorptionStrength: number;    // 0..1
  imbalancePressure: number;     // -1..1
  
  // Volume features
  volumeRatio: number;           // 0..3+ (normalized)
  volumeDelta: number;           // -1..1
  
  // OI features
  oiDelta: number;               // -1..1
  oiVolumeDivergence: number;    // 0..1
  
  // Liquidation features
  cascadeActive: number;         // 0 or 1
  liquidationIntensity: number;  // 0..1
  
  // Pattern features
  patternCount: number;          // 0..N (normalized 0..1)
  conflictCount: number;         // 0..N
  bullishRatio: number;          // 0..1
  bearishRatio: number;          // 0..1
  
  // Derived features
  marketStress: number;          // 0..1 (composite)
  readability: number;           // 0..1 (composite)
}

// ═══════════════════════════════════════════════════════════════
// MACRO CONTEXT FEATURES (Market Regime Engine - OPTIONAL)
// ═══════════════════════════════════════════════════════════════

export interface MacroContextFeatures {
  // Market Regime (enum encoded)
  macroRegimeId: number;         // 0..7 (8 regimes)
  
  // Risk Level (enum encoded)
  macroRiskLevel: number;        // 0..3 (LOW/MED/HIGH/EXTREME)
  
  // Fear & Greed (bucketed)
  fearGreedBucket: number;       // 0..4 (EXTREME_FEAR to EXTREME_GREED)
  
  // Trend directions
  btcDomTrend: number;           // -1, 0, 1 (DOWN/FLAT/UP)
  stableDomTrend: number;        // -1, 0, 1
  
  // Capital flow (derived)
  capitalFlowBias: number;       // -1, 0, 1 (outflow/neutral/inflow)
}

// Combined features for training
export interface MLFeaturesWithMacro extends MLFeatures {
  macro?: MacroContextFeatures;
}

// ═══════════════════════════════════════════════════════════════
// ML RESULT (Model output)
// ═══════════════════════════════════════════════════════════════

export interface MLResult {
  label: MLLabel;
  confidence: number;            // 0..1
  probabilities: {
    USE: number;
    IGNORE: number;
    WARNING: number;
  };
  
  // Explanation
  topFeatures: Array<{
    name: string;
    value: number;
    contribution: number;
  }>;
  
  // Debug
  rulesLabel?: MLLabel;          // What rules-based would say
  rulesMatch?: boolean;          // Does ML agree with rules?
}

// ═══════════════════════════════════════════════════════════════
// LABELING RESULT (for backfill)
// ═══════════════════════════════════════════════════════════════

export interface LabelingResult {
  label: MLLabel;
  reason: string;
  triggers: string[];
}

// ═══════════════════════════════════════════════════════════════
// BACKFILL STATS
// ═══════════════════════════════════════════════════════════════

export interface BackfillStats {
  totalProcessed: number;
  labeled: {
    USE: number;
    IGNORE: number;
    WARNING: number;
  };
  distribution: {
    USE: number;      // percentage
    IGNORE: number;
    WARNING: number;
  };
  warningReasons: Record<string, number>;
  errors: number;
}

// ═══════════════════════════════════════════════════════════════
// MODEL STATUS
// ═══════════════════════════════════════════════════════════════

export interface ModelStatus {
  modelType: 'rules' | 'logistic' | 'tree' | 'ensemble';
  version: string;
  trainedAt: number | null;
  trainingSize: number;
  accuracy: number | null;
  featureImportance: Record<string, number> | null;
  classDistribution: {
    USE: number;
    IGNORE: number;
    WARNING: number;
  } | null;
}

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS (Configurable)
// ═══════════════════════════════════════════════════════════════

export interface LabelingThresholds {
  // WARNING triggers
  liquidationIntensityWarning: number;    // default 0.7
  conflictCountWarning: number;           // default 2
  regimeConfidenceWarning: number;        // default 0.6
  
  // USE requirements
  regimeConfidenceUse: number;            // default 0.65
  maxConflictsUse: number;                // default 0
  minReadabilityUse: number;              // default 0.5
}

export const DEFAULT_THRESHOLDS: LabelingThresholds = {
  liquidationIntensityWarning: 0.7,
  conflictCountWarning: 2,
  regimeConfidenceWarning: 0.6,
  regimeConfidenceUse: 0.65,
  maxConflictsUse: 0,
  minReadabilityUse: 0.5,
};

// ═══════════════════════════════════════════════════════════════
// ML TRAINING CONFIG (Macro-aware)
// ═══════════════════════════════════════════════════════════════

export interface MLTrainingConfig {
  // Run metadata
  runName: string;
  mode: 'SHADOW_ONLY' | 'PRODUCTION';
  
  // Constraints (LOCKED)
  constraints: {
    neverIncreaseConfidence: boolean;
    neverChangeDirection: boolean;
    applyOnlyWhenDataMode: ('LIVE' | 'CACHED' | 'MIXED')[];
    blockIfDrift: boolean;
  };
  
  // Dataset
  dataset: {
    collection: string;
    timeSplit: {
      type: 'TIME_BASED';
      trainPct: number;
      valPct: number;
      testPct: number;
      minTrainRows: number;
      minTestRows: number;
    };
    filters: {
      symbols: string[];
      requireTruth: boolean;
      requireLiveSource: boolean;
    };
  };
  
  // Features
  features: {
    base: string[];
    macro: {
      enabled: boolean;
      optional: boolean;  // If true, rows without macro are still used
      fields: string[];
    };
  };
  
  // Model config
  models: Array<{
    name: string;
    type: 'LOGISTIC_REGRESSION' | 'DECISION_TREE';
    regularization?: { l2: number };
    training: {
      epochs: number;
      learningRate: number;
      earlyStop: boolean;
      earlyStopPatience: number;
    };
  }>;
  
  // Evaluation
  evaluation: {
    metrics: ('ACCURACY' | 'Brier' | 'ECE' | 'AUC')[];
    acceptance: {
      minAccuracyDeltaVsActive: number;
      maxBrierDeltaVsActive: number;
      maxEce: number;
      maxDriftScore: number;
    };
  };
  
  // Promotion
  promotion: {
    registryCollection: string;
    candidateTag: string;
    autoPromote: boolean;
    manualPromoteRequires: string[];
  };
}

export const DEFAULT_MACRO_TRAINING_CONFIG: MLTrainingConfig = {
  runName: 'calibration_v2_macro',
  mode: 'SHADOW_ONLY',
  
  constraints: {
    neverIncreaseConfidence: true,
    neverChangeDirection: true,
    applyOnlyWhenDataMode: ['LIVE', 'CACHED'],
    blockIfDrift: true,
  },
  
  dataset: {
    collection: 'ml_dataset_v1',
    timeSplit: {
      type: 'TIME_BASED',
      trainPct: 0.7,
      valPct: 0.15,
      testPct: 0.15,
      minTrainRows: 800,
      minTestRows: 200,
    },
    filters: {
      symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      requireTruth: true,
      requireLiveSource: true,
    },
  },
  
  features: {
    base: [
      'regimeConfidence',
      'marketStress',
      'readability',
      'flowBias',
      'volumeRatio',
      'liquidationIntensity',
      'conflictCount',
    ],
    macro: {
      enabled: true,
      optional: true,
      fields: [
        'macroRegimeId',
        'macroRiskLevel',
        'fearGreedBucket',
        'btcDomTrend',
        'stableDomTrend',
        'capitalFlowBias',
      ],
    },
  },
  
  models: [
    {
      name: 'logreg_calibrator_macro',
      type: 'LOGISTIC_REGRESSION',
      regularization: { l2: 0.8 },
      training: {
        epochs: 200,
        learningRate: 0.05,
        earlyStop: true,
        earlyStopPatience: 15,
      },
    },
  ],
  
  evaluation: {
    metrics: ['ACCURACY', 'Brier', 'ECE', 'AUC'],
    acceptance: {
      minAccuracyDeltaVsActive: -0.02,
      maxBrierDeltaVsActive: 0.02,
      maxEce: 0.12,
      maxDriftScore: 0.30,
    },
  },
  
  promotion: {
    registryCollection: 'ml_model_registry',
    candidateTag: 'CANDIDATE',
    autoPromote: false,
    manualPromoteRequires: ['PROMOTE_CONFIRM'],
  },
};

