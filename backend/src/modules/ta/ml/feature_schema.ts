/**
 * Phase W: ML Feature Schema
 * 
 * Defines the exact feature structure for ML training.
 * v1: ~50 features for LightGBM/CatBoost
 */

export interface MLFeatures {
  // ═══════════════════════════════════════════════════════════════
  // GROUP A: Scenario Core
  // ═══════════════════════════════════════════════════════════════
  scenarioScore: number;        // After confluence
  effectiveScore: number;       // After reliability
  baselineProb: number;         // Calibrated v2 probability
  topBias: number;              // -1=BEAR, 0=NEUTRAL, 1=BULL

  // ═══════════════════════════════════════════════════════════════
  // GROUP B: Market Regime (one-hot)
  // ═══════════════════════════════════════════════════════════════
  regime_UP: number;
  regime_DOWN: number;
  regime_RANGE: number;
  regime_TRANSITION: number;
  
  vol_LOW: number;
  vol_NORMAL: number;
  vol_HIGH: number;
  vol_EXTREME: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP C: Pattern Composition
  // ═══════════════════════════════════════════════════════════════
  patterns_triangles: number;
  patterns_flags: number;
  patterns_reversals: number;
  patterns_harmonics: number;
  patterns_candles: number;
  patterns_liquidity: number;
  patterns_elliott: number;
  patterns_divergences: number;
  patterns_structure: number;
  patterns_ma: number;
  
  // Best scores per family
  best_triangle_score: number;
  best_flag_score: number;
  best_reversal_score: number;
  best_harmonic_score: number;
  best_candle_score: number;
  best_liquidity_score: number;
  best_divergence_score: number;
  
  // Pattern counts
  total_patterns: number;
  unique_pattern_types: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP D: Confluence Factors
  // ═══════════════════════════════════════════════════════════════
  ma_alignment: number;         // 0 or 1
  fib_confluence: number;       // 0 or 1
  structure_support: number;    // 0 or 1
  sr_proximity: number;         // 0 or 1
  volatility_gate: number;      // 0-1 score
  
  conflict_hard_count: number;
  conflict_soft_count: number;
  confluence_bonus_total: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP E: Risk Pack
  // ═══════════════════════════════════════════════════════════════
  rrToT1: number;               // Risk/Reward to Target 1
  rrToT2: number;               // Risk/Reward to Target 2
  riskPct: number;              // Entry to Stop %
  rewardPct: number;            // Entry to Target %
  entryDistATR: number;         // Entry distance in ATR
  stopDistATR: number;          // Stop distance in ATR
  targetDistATR: number;        // Target distance in ATR
  
  // Entry type one-hot
  entry_BREAKOUT: number;
  entry_RETEST: number;
  entry_MARKET: number;
  entry_LIMIT: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP F: Reliability Priors
  // ═══════════════════════════════════════════════════════════════
  patternPrior: number;         // Historical win rate
  patternPriorDecay: number;    // Decay-weighted prior
  clusterStrength: number;      // Reliability cluster score
  avgPatternReliability: number;
}

export interface MLDatasetRow {
  // Identifiers
  rowId: string;             // Unique row ID
  runId: string;
  scenarioId: string;
  
  // Context
  symbol: string;
  timeframe: string;
  timestamp: number;
  
  // Features
  features: MLFeatures;
  
  // Label (target)
  label: number;  // 1=WIN, 0=LOSS
  
  // Metadata for analysis
  meta: {
    entry: number;
    stop: number;
    target: number;
    outcome?: string;
    mfe?: number;
    mae?: number;
    holdBars?: number;
    // Phase 3.1 additions
    rMultiple?: number;
    mfePct?: number;
    maePct?: number;
    barsInTrade?: number;
    exitReason?: string;
    side?: string;
  };
}

/**
 * Get feature names for ML training
 */
export function getFeatureNames(): string[] {
  return [
    // Group A
    'scenarioScore', 'effectiveScore', 'baselineProb', 'topBias',
    // Group B
    'regime_UP', 'regime_DOWN', 'regime_RANGE', 'regime_TRANSITION',
    'vol_LOW', 'vol_NORMAL', 'vol_HIGH', 'vol_EXTREME',
    // Group C
    'patterns_triangles', 'patterns_flags', 'patterns_reversals',
    'patterns_harmonics', 'patterns_candles', 'patterns_liquidity',
    'patterns_elliott', 'patterns_divergences', 'patterns_structure', 'patterns_ma',
    'best_triangle_score', 'best_flag_score', 'best_reversal_score',
    'best_harmonic_score', 'best_candle_score', 'best_liquidity_score',
    'best_divergence_score', 'total_patterns', 'unique_pattern_types',
    // Group D
    'ma_alignment', 'fib_confluence', 'structure_support', 'sr_proximity',
    'volatility_gate', 'conflict_hard_count', 'conflict_soft_count', 'confluence_bonus_total',
    // Group E
    'rrToT1', 'rrToT2', 'riskPct', 'rewardPct',
    'entryDistATR', 'stopDistATR', 'targetDistATR',
    'entry_BREAKOUT', 'entry_RETEST', 'entry_MARKET', 'entry_LIMIT',
    // Group F
    'patternPrior', 'patternPriorDecay', 'clusterStrength', 'avgPatternReliability',
  ];
}

/**
 * Create empty features object with defaults
 */
export function createEmptyFeatures(): MLFeatures {
  return {
    scenarioScore: 0,
    effectiveScore: 0,
    baselineProb: 0.5,
    topBias: 0,
    regime_UP: 0,
    regime_DOWN: 0,
    regime_RANGE: 0,
    regime_TRANSITION: 0,
    vol_LOW: 0,
    vol_NORMAL: 1,
    vol_HIGH: 0,
    vol_EXTREME: 0,
    patterns_triangles: 0,
    patterns_flags: 0,
    patterns_reversals: 0,
    patterns_harmonics: 0,
    patterns_candles: 0,
    patterns_liquidity: 0,
    patterns_elliott: 0,
    patterns_divergences: 0,
    patterns_structure: 0,
    patterns_ma: 0,
    best_triangle_score: 0,
    best_flag_score: 0,
    best_reversal_score: 0,
    best_harmonic_score: 0,
    best_candle_score: 0,
    best_liquidity_score: 0,
    best_divergence_score: 0,
    total_patterns: 0,
    unique_pattern_types: 0,
    ma_alignment: 0,
    fib_confluence: 0,
    structure_support: 0,
    sr_proximity: 0,
    volatility_gate: 0,
    conflict_hard_count: 0,
    conflict_soft_count: 0,
    confluence_bonus_total: 0,
    rrToT1: 0,
    rrToT2: 0,
    riskPct: 0,
    rewardPct: 0,
    entryDistATR: 0,
    stopDistATR: 0,
    targetDistATR: 0,
    entry_BREAKOUT: 0,
    entry_RETEST: 0,
    entry_MARKET: 0,
    entry_LIMIT: 0,
    patternPrior: 0.5,
    patternPriorDecay: 0.5,
    clusterStrength: 0,
    avgPatternReliability: 0.5,
  };
}
