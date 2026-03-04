/**
 * Phase 5: ML Feature Schema v2
 * 
 * Extended feature set (~80 features) for LightGBM/CatBoost training.
 * Organized by category for interpretability.
 * 
 * Categories:
 * 1. Pattern Geometry (~15)
 * 2. Pattern Context (~10)
 * 3. Support/Resistance (~10)
 * 4. Volatility (~8)
 * 5. Momentum (~8)
 * 6. Volume (~6)
 * 7. Market Structure (~7)
 * 8. Risk (~6)
 * 9. Pattern Reliability (~6)
 * 10. Time (~4)
 */

// ═══════════════════════════════════════════════════════════════
// FEATURE INTERFACE v2
// ═══════════════════════════════════════════════════════════════

export interface MLFeaturesV2 {
  // ═══════════════════════════════════════════════════════════════
  // GROUP 1: Pattern Geometry (~15 features)
  // ═══════════════════════════════════════════════════════════════
  
  /** Pattern type encoded (e.g., triangle=1, flag=2, etc.) */
  pattern_type_id: number;
  /** Pattern family encoded */
  pattern_family_id: number;
  
  /** Height of pattern as % of price */
  pattern_height_pct: number;
  /** Width in bars */
  pattern_width_bars: number;
  /** Duration normalized by timeframe */
  pattern_duration_norm: number;
  
  /** Distance to breakout level % */
  breakout_distance_pct: number;
  /** Angle of breakout direction (radians normalized) */
  breakout_angle: number;
  
  /** Slope of upper trendline */
  upper_slope: number;
  /** Slope of lower trendline */
  lower_slope: number;
  
  /** Pattern symmetry (0-1) */
  symmetry_score: number;
  /** Compression ratio (narrowing) */
  compression_score: number;
  
  /** Touch count on upper boundary */
  touches_upper: number;
  /** Touch count on lower boundary */
  touches_lower: number;
  
  /** Position in current trend (0=start, 1=end) */
  pattern_position_in_trend: number;
  /** Position in range (0-1) */
  pattern_position_in_range: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP 2: Pattern Context (~10 features)
  // ═══════════════════════════════════════════════════════════════
  
  /** Trend direction: -1=down, 0=range, 1=up */
  trend_direction: number;
  /** Trend strength (0-1) */
  trend_strength: number;
  /** Trend duration in bars */
  trend_duration_bars: number;
  
  /** Distance from trend start (bars) */
  distance_from_trend_start: number;
  /** Distance from last significant pivot */
  distance_from_last_pivot: number;
  
  /** Range width as % */
  range_width_pct: number;
  /** Position within current range (0-1) */
  range_position: number;
  
  /** Pivot density (pivots per 50 bars) */
  pivot_density: number;
  /** Structure breaks in last 50 bars */
  structure_breaks_50: number;
  /** Prior swing magnitude % */
  prior_swing_pct: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP 3: Support/Resistance (~10 features)
  // ═══════════════════════════════════════════════════════════════
  
  /** Distance to nearest support % */
  distance_to_support_pct: number;
  /** Distance to nearest resistance % */
  distance_to_resistance_pct: number;
  
  /** Support strength (touch count * age factor) */
  support_strength: number;
  /** Resistance strength */
  resistance_strength: number;
  
  /** Total touches on nearest level */
  level_touch_count: number;
  /** Age of nearest level in bars */
  level_age_bars: number;
  
  /** Distance to nearest liquidity zone % */
  distance_to_liquidity_pct: number;
  /** Liquidity zone strength */
  liquidity_strength: number;
  
  /** S/R ratio (support vs resistance strength) */
  sr_ratio: number;
  /** Level density (levels per 5% range) */
  level_density: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP 4: Volatility (~8 features)
  // ═══════════════════════════════════════════════════════════════
  
  /** Current ATR value */
  atr: number;
  /** ATR percentile (0-1) over lookback */
  atr_percentile: number;
  
  /** Volatility regime: 0=low, 1=normal, 2=high, 3=extreme */
  volatility_regime: number;
  
  /** Is volatility expanding? (1=yes) */
  volatility_expanding: number;
  /** Is volatility compressing? (1=yes) */
  volatility_compressing: number;
  
  /** Mean candle range over 20 bars */
  candle_range_mean_20: number;
  /** Mean candle range over 50 bars */
  candle_range_mean_50: number;
  /** Ratio of recent to historical vol */
  vol_ratio_20_50: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP 5: Momentum (~8 features)
  // ═══════════════════════════════════════════════════════════════
  
  /** RSI value (0-100 normalized to 0-1) */
  rsi: number;
  /** RSI slope (rate of change) */
  rsi_slope: number;
  
  /** MACD histogram value */
  macd_histogram: number;
  /** MACD histogram slope */
  macd_slope: number;
  
  /** Overall momentum strength (0-1) */
  momentum_strength: number;
  /** Momentum divergence flag */
  momentum_divergence: number;
  
  /** Price velocity (rate of change) */
  price_velocity: number;
  /** Price acceleration */
  price_acceleration: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP 6: Volume (~6 features)
  // ═══════════════════════════════════════════════════════════════
  
  /** Mean volume over 20 bars (normalized) */
  volume_mean_20: number;
  /** Volume spike score (current vs mean) */
  volume_spike_score: number;
  
  /** Volume trend: -1=declining, 0=flat, 1=increasing */
  volume_trend: number;
  /** Volume on breakout candle (ratio) */
  volume_on_breakout: number;
  
  /** Volume divergence with price */
  volume_divergence: number;
  /** Volume profile imbalance */
  volume_imbalance: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP 7: Market Structure (~7 features)
  // ═══════════════════════════════════════════════════════════════
  
  /** Market phase: 0=accumulation, 1=markup, 2=distribution, 3=markdown */
  market_phase: number;
  /** Trend vs range score (0=range, 1=trend) */
  trend_vs_range: number;
  
  /** Break of structure count in 50 bars */
  bos_count_50: number;
  /** Change of character recency (bars since) */
  choch_bars_ago: number;
  
  /** Overall structure strength */
  structure_strength: number;
  /** Swing density (swings per 20 bars) */
  swing_density: number;
  /** Higher timeframe alignment */
  htf_alignment: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP 8: Risk (~6 features)
  // ═══════════════════════════════════════════════════════════════
  
  /** Stop distance as % of price */
  stop_distance_pct: number;
  /** Risk/Reward to target 1 */
  rr_to_target1: number;
  /** Risk/Reward to target 2 */
  rr_to_target2: number;
  
  /** Expected position duration (bars) */
  position_duration_expected: number;
  /** Risk relative to current volatility */
  risk_to_volatility: number;
  /** Entry quality score (0-1) */
  entry_quality: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP 9: Pattern Reliability (~6 features)
  // ═══════════════════════════════════════════════════════════════
  
  /** Historical success rate for this pattern */
  pattern_prior_winrate: number;
  /** Success rate in current regime */
  pattern_winrate_regime: number;
  /** Decay-weighted historical rate */
  pattern_decay_rate: number;
  
  /** Cluster density (similar patterns nearby) */
  cluster_density: number;
  /** Similar patterns in last 100 bars */
  similar_patterns_100: number;
  /** Behaviour-adjusted probability */
  behaviour_probability: number;

  // ═══════════════════════════════════════════════════════════════
  // GROUP 10: Time Features (~4 features)
  // ═══════════════════════════════════════════════════════════════
  
  /** Day of week (0-6) normalized */
  day_of_week: number;
  /** Month (1-12) normalized */
  month: number;
  /** Session type: 0=asian, 1=european, 2=american */
  session_type: number;
  /** Bar index within current trend */
  bar_index_in_trend: number;
}

// ═══════════════════════════════════════════════════════════════
// DATASET ROW v2
// ═══════════════════════════════════════════════════════════════

export interface MLDatasetRowV2 {
  // Identifiers
  rowId: string;
  runId: string;
  scenarioId: string;
  
  // Context
  symbol: string;
  timeframe: string;
  timestamp: number;
  
  // Version
  schemaVersion: 'v2';
  
  // Features (~80)
  features: MLFeaturesV2;
  
  // Labels (multiple targets)
  labels: {
    /** Primary: 1=win, 0=loss */
    winLoss: number;
    /** R-multiple achieved */
    rMultiple: number;
    /** Maximum favorable excursion % */
    mfePct: number;
    /** Maximum adverse excursion % */
    maePct: number;
    /** Bars held in trade */
    barsInTrade: number;
  };
  
  // Metadata for analysis
  meta: {
    patternType: string;
    patternFamily: string;
    entryPrice: number;
    stopPrice: number;
    target1Price: number;
    target2Price?: number;
    exitPrice: number;
    exitReason: string;
    side: 'LONG' | 'SHORT';
    regime: string;
    volatilityRegime: string;
  };
  
  // Timestamps
  createdAt: number;
  processedAt?: number;
}

// ═══════════════════════════════════════════════════════════════
// FEATURE NAMES (for ML frameworks)
// ═══════════════════════════════════════════════════════════════

export function getFeatureNamesV2(): string[] {
  return [
    // Group 1: Pattern Geometry
    'pattern_type_id', 'pattern_family_id', 'pattern_height_pct', 'pattern_width_bars',
    'pattern_duration_norm', 'breakout_distance_pct', 'breakout_angle',
    'upper_slope', 'lower_slope', 'symmetry_score', 'compression_score',
    'touches_upper', 'touches_lower', 'pattern_position_in_trend', 'pattern_position_in_range',
    
    // Group 2: Pattern Context
    'trend_direction', 'trend_strength', 'trend_duration_bars', 'distance_from_trend_start',
    'distance_from_last_pivot', 'range_width_pct', 'range_position', 'pivot_density',
    'structure_breaks_50', 'prior_swing_pct',
    
    // Group 3: Support/Resistance
    'distance_to_support_pct', 'distance_to_resistance_pct', 'support_strength',
    'resistance_strength', 'level_touch_count', 'level_age_bars', 'distance_to_liquidity_pct',
    'liquidity_strength', 'sr_ratio', 'level_density',
    
    // Group 4: Volatility
    'atr', 'atr_percentile', 'volatility_regime', 'volatility_expanding',
    'volatility_compressing', 'candle_range_mean_20', 'candle_range_mean_50', 'vol_ratio_20_50',
    
    // Group 5: Momentum
    'rsi', 'rsi_slope', 'macd_histogram', 'macd_slope', 'momentum_strength',
    'momentum_divergence', 'price_velocity', 'price_acceleration',
    
    // Group 6: Volume
    'volume_mean_20', 'volume_spike_score', 'volume_trend', 'volume_on_breakout',
    'volume_divergence', 'volume_imbalance',
    
    // Group 7: Market Structure
    'market_phase', 'trend_vs_range', 'bos_count_50', 'choch_bars_ago',
    'structure_strength', 'swing_density', 'htf_alignment',
    
    // Group 8: Risk
    'stop_distance_pct', 'rr_to_target1', 'rr_to_target2', 'position_duration_expected',
    'risk_to_volatility', 'entry_quality',
    
    // Group 9: Pattern Reliability
    'pattern_prior_winrate', 'pattern_winrate_regime', 'pattern_decay_rate',
    'cluster_density', 'similar_patterns_100', 'behaviour_probability',
    
    // Group 10: Time
    'day_of_week', 'month', 'session_type', 'bar_index_in_trend',
  ];
}

export function getFeatureCountV2(): number {
  return getFeatureNamesV2().length;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT/EMPTY FEATURES
// ═══════════════════════════════════════════════════════════════

export function createEmptyFeaturesV2(): MLFeaturesV2 {
  return {
    // Group 1: Pattern Geometry
    pattern_type_id: 0,
    pattern_family_id: 0,
    pattern_height_pct: 0,
    pattern_width_bars: 0,
    pattern_duration_norm: 0,
    breakout_distance_pct: 0,
    breakout_angle: 0,
    upper_slope: 0,
    lower_slope: 0,
    symmetry_score: 0,
    compression_score: 0,
    touches_upper: 0,
    touches_lower: 0,
    pattern_position_in_trend: 0.5,
    pattern_position_in_range: 0.5,
    
    // Group 2: Pattern Context
    trend_direction: 0,
    trend_strength: 0,
    trend_duration_bars: 0,
    distance_from_trend_start: 0,
    distance_from_last_pivot: 0,
    range_width_pct: 0,
    range_position: 0.5,
    pivot_density: 0,
    structure_breaks_50: 0,
    prior_swing_pct: 0,
    
    // Group 3: Support/Resistance
    distance_to_support_pct: 0,
    distance_to_resistance_pct: 0,
    support_strength: 0,
    resistance_strength: 0,
    level_touch_count: 0,
    level_age_bars: 0,
    distance_to_liquidity_pct: 0,
    liquidity_strength: 0,
    sr_ratio: 1,
    level_density: 0,
    
    // Group 4: Volatility
    atr: 0,
    atr_percentile: 0.5,
    volatility_regime: 1,
    volatility_expanding: 0,
    volatility_compressing: 0,
    candle_range_mean_20: 0,
    candle_range_mean_50: 0,
    vol_ratio_20_50: 1,
    
    // Group 5: Momentum
    rsi: 0.5,
    rsi_slope: 0,
    macd_histogram: 0,
    macd_slope: 0,
    momentum_strength: 0.5,
    momentum_divergence: 0,
    price_velocity: 0,
    price_acceleration: 0,
    
    // Group 6: Volume
    volume_mean_20: 0,
    volume_spike_score: 1,
    volume_trend: 0,
    volume_on_breakout: 1,
    volume_divergence: 0,
    volume_imbalance: 0,
    
    // Group 7: Market Structure
    market_phase: 1,
    trend_vs_range: 0.5,
    bos_count_50: 0,
    choch_bars_ago: 50,
    structure_strength: 0.5,
    swing_density: 0,
    htf_alignment: 0,
    
    // Group 8: Risk
    stop_distance_pct: 0,
    rr_to_target1: 0,
    rr_to_target2: 0,
    position_duration_expected: 0,
    risk_to_volatility: 1,
    entry_quality: 0.5,
    
    // Group 9: Pattern Reliability
    pattern_prior_winrate: 0.5,
    pattern_winrate_regime: 0.5,
    pattern_decay_rate: 0.5,
    cluster_density: 0,
    similar_patterns_100: 0,
    behaviour_probability: 0.5,
    
    // Group 10: Time
    day_of_week: 0,
    month: 0,
    session_type: 0,
    bar_index_in_trend: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// PATTERN TYPE/FAMILY ENCODING
// ═══════════════════════════════════════════════════════════════

export const PATTERN_TYPE_ENCODING: Record<string, number> = {
  'unknown': 0,
  'ascending_triangle': 1,
  'descending_triangle': 2,
  'symmetric_triangle': 3,
  'bull_flag': 4,
  'bear_flag': 5,
  'bull_pennant': 6,
  'bear_pennant': 7,
  'head_and_shoulders': 8,
  'inverse_head_and_shoulders': 9,
  'double_top': 10,
  'double_bottom': 11,
  'triple_top': 12,
  'triple_bottom': 13,
  'rising_wedge': 14,
  'falling_wedge': 15,
  'rectangle': 16,
  'channel_up': 17,
  'channel_down': 18,
  'gartley': 19,
  'butterfly': 20,
  'bat': 21,
  'crab': 22,
  'cypher': 23,
  'elliott_impulse': 24,
  'elliott_correction': 25,
  'engulfing_bull': 26,
  'engulfing_bear': 27,
  'doji': 28,
  'hammer': 29,
  'shooting_star': 30,
  'bullish_divergence': 31,
  'bearish_divergence': 32,
  'hidden_bullish_divergence': 33,
  'hidden_bearish_divergence': 34,
  'order_block_bull': 35,
  'order_block_bear': 36,
  'fair_value_gap': 37,
  'liquidity_sweep': 38,
};

export const PATTERN_FAMILY_ENCODING: Record<string, number> = {
  'unknown': 0,
  'triangles': 1,
  'flags': 2,
  'reversals': 3,
  'harmonics': 4,
  'elliott': 5,
  'candles': 6,
  'divergences': 7,
  'liquidity': 8,
  'channels': 9,
  'structure': 10,
};

export function encodePatternType(type: string): number {
  return PATTERN_TYPE_ENCODING[type.toLowerCase()] ?? 0;
}

export function encodePatternFamily(family: string): number {
  return PATTERN_FAMILY_ENCODING[family.toLowerCase()] ?? 0;
}

// ═══════════════════════════════════════════════════════════════
// FEATURE ARRAY CONVERSION (for ML frameworks)
// ═══════════════════════════════════════════════════════════════

export function featuresToArray(features: MLFeaturesV2): number[] {
  const names = getFeatureNamesV2();
  return names.map(name => (features as any)[name] ?? 0);
}

export function arrayToFeatures(arr: number[]): MLFeaturesV2 {
  const names = getFeatureNamesV2();
  const features = createEmptyFeaturesV2();
  names.forEach((name, i) => {
    (features as any)[name] = arr[i] ?? 0;
  });
  return features;
}

// ═══════════════════════════════════════════════════════════════
// CSV HEADER
// ═══════════════════════════════════════════════════════════════

export function getCSVHeader(): string {
  const featureNames = getFeatureNamesV2();
  const labelNames = ['winLoss', 'rMultiple', 'mfePct', 'maePct', 'barsInTrade'];
  const metaNames = ['symbol', 'timeframe', 'timestamp', 'patternType', 'side', 'exitReason'];
  
  return [...metaNames, ...featureNames, ...labelNames].join(',');
}

export function rowToCSV(row: MLDatasetRowV2): string {
  const featureArr = featuresToArray(row.features);
  const labels = [
    row.labels.winLoss,
    row.labels.rMultiple,
    row.labels.mfePct,
    row.labels.maePct,
    row.labels.barsInTrade,
  ];
  const meta = [
    row.symbol,
    row.timeframe,
    row.timestamp,
    row.meta.patternType,
    row.meta.side,
    row.meta.exitReason,
  ];
  
  return [...meta, ...featureArr, ...labels].join(',');
}
