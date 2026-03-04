/**
 * Phase 5: Feature Extractor v2
 * 
 * Extracts ~80 features from market data, patterns, and context.
 * Each feature is normalized and ready for ML.
 */

import {
  MLFeaturesV2,
  createEmptyFeaturesV2,
  encodePatternType,
  encodePatternFamily,
} from './feature_schema_v2.js';

// ═══════════════════════════════════════════════════════════════
// INPUT TYPES
// ═══════════════════════════════════════════════════════════════

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Pattern {
  type: string;
  family: string;
  score: number;
  geometry?: {
    upperSlope?: number;
    lowerSlope?: number;
    height?: number;
    width?: number;
    touchesUpper?: number;
    touchesLower?: number;
    symmetry?: number;
    compression?: number;
    breakoutLevel?: number;
  };
  startIdx?: number;
  endIdx?: number;
}

export interface StructureContext {
  regime?: string;
  trendDirection?: number;
  trendStrength?: number;
  trendDuration?: number;
  rangeWidth?: number;
  rangePosition?: number;
  pivots?: { ts: number; price: number; type: 'H' | 'L' }[];
  levels?: { price: number; strength: number; type: 'support' | 'resistance'; touches: number; age: number }[];
  liquidityZones?: { price: number; strength: number }[];
}

export interface IndicatorContext {
  rsi?: number;
  rsiPrev?: number;
  macd?: { histogram: number; histogramPrev?: number };
  atr?: number;
  atrHistory?: number[];
  ma20?: number;
  ma50?: number;
  ma200?: number;
}

export interface RiskContext {
  entry?: number;
  stop?: number;
  target1?: number;
  target2?: number;
  side?: 'LONG' | 'SHORT';
}

export interface ReliabilityContext {
  patternPrior?: number;
  patternPriorRegime?: number;
  patternDecay?: number;
  clusterDensity?: number;
  similarPatterns?: number;
  behaviourProb?: number;
}

export interface ExtractorInputV2 {
  candles: Candle[];
  pattern?: Pattern;
  patterns?: Pattern[];
  structure?: StructureContext;
  indicators?: IndicatorContext;
  risk?: RiskContext;
  reliability?: ReliabilityContext;
  timestamp?: number;
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXTRACTOR
// ═══════════════════════════════════════════════════════════════

export function extractFeaturesV2(input: ExtractorInputV2): MLFeaturesV2 {
  const features = createEmptyFeaturesV2();
  const { candles, pattern, patterns, structure, indicators, risk, reliability, timestamp } = input;
  
  if (!candles || candles.length < 20) {
    return features;
  }
  
  const price = candles[candles.length - 1].close;
  const primaryPattern = pattern || patterns?.[0];
  
  // ═══════════════════════════════════════════════════════════════
  // GROUP 1: Pattern Geometry
  // ═══════════════════════════════════════════════════════════════
  
  if (primaryPattern) {
    features.pattern_type_id = encodePatternType(primaryPattern.type);
    features.pattern_family_id = encodePatternFamily(primaryPattern.family);
    
    const geom = primaryPattern.geometry;
    if (geom) {
      features.pattern_height_pct = (geom.height ?? 0) / price * 100;
      features.pattern_width_bars = geom.width ?? 0;
      features.pattern_duration_norm = (geom.width ?? 0) / 50; // normalized to 50 bars
      
      if (geom.breakoutLevel && price > 0) {
        features.breakout_distance_pct = Math.abs(price - geom.breakoutLevel) / price * 100;
      }
      
      features.upper_slope = geom.upperSlope ?? 0;
      features.lower_slope = geom.lowerSlope ?? 0;
      
      // Breakout angle from slopes
      const avgSlope = ((geom.upperSlope ?? 0) + (geom.lowerSlope ?? 0)) / 2;
      features.breakout_angle = Math.atan(avgSlope) / Math.PI; // normalize to [-0.5, 0.5]
      
      features.symmetry_score = geom.symmetry ?? 0;
      features.compression_score = geom.compression ?? 0;
      features.touches_upper = geom.touchesUpper ?? 0;
      features.touches_lower = geom.touchesLower ?? 0;
    }
    
    // Pattern position
    if (structure?.trendDuration && structure.trendDuration > 0) {
      const patternStart = primaryPattern.startIdx ?? candles.length - 20;
      features.pattern_position_in_trend = Math.min(1, patternStart / structure.trendDuration);
    }
    
    if (structure?.rangeWidth && structure.rangeWidth > 0) {
      const rangeHigh = Math.max(...candles.slice(-50).map(c => c.high));
      const rangeLow = Math.min(...candles.slice(-50).map(c => c.low));
      features.pattern_position_in_range = (price - rangeLow) / (rangeHigh - rangeLow);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // GROUP 2: Pattern Context
  // ═══════════════════════════════════════════════════════════════
  
  if (structure) {
    features.trend_direction = structure.trendDirection ?? 0;
    features.trend_strength = structure.trendStrength ?? 0;
    features.trend_duration_bars = structure.trendDuration ?? 0;
    features.distance_from_trend_start = Math.min(1, (structure.trendDuration ?? 0) / 100);
    
    // Distance from last pivot
    if (structure.pivots && structure.pivots.length > 0) {
      const lastPivot = structure.pivots[structure.pivots.length - 1];
      const pivotIdx = candles.findIndex(c => c.ts >= lastPivot.ts);
      features.distance_from_last_pivot = candles.length - pivotIdx;
      features.pivot_density = structure.pivots.length / 50;
    }
    
    features.range_width_pct = structure.rangeWidth ?? 0;
    features.range_position = structure.rangePosition ?? 0.5;
  }
  
  // Structure breaks (count significant swings)
  features.structure_breaks_50 = countStructureBreaks(candles.slice(-50));
  
  // Prior swing
  features.prior_swing_pct = calculatePriorSwing(candles.slice(-50), price);
  
  // ═══════════════════════════════════════════════════════════════
  // GROUP 3: Support/Resistance
  // ═══════════════════════════════════════════════════════════════
  
  if (structure?.levels && structure.levels.length > 0) {
    const supports = structure.levels.filter(l => l.type === 'support');
    const resistances = structure.levels.filter(l => l.type === 'resistance');
    
    if (supports.length > 0) {
      const nearest = supports.reduce((a, b) => 
        Math.abs(a.price - price) < Math.abs(b.price - price) ? a : b
      );
      features.distance_to_support_pct = Math.abs(price - nearest.price) / price * 100;
      features.support_strength = nearest.strength;
      features.level_touch_count = nearest.touches;
      features.level_age_bars = nearest.age;
    }
    
    if (resistances.length > 0) {
      const nearest = resistances.reduce((a, b) => 
        Math.abs(a.price - price) < Math.abs(b.price - price) ? a : b
      );
      features.distance_to_resistance_pct = Math.abs(price - nearest.price) / price * 100;
      features.resistance_strength = nearest.strength;
    }
    
    features.sr_ratio = features.support_strength / Math.max(0.1, features.resistance_strength);
    features.level_density = structure.levels.length / 5; // per 5% range
  }
  
  // Liquidity zones
  if (structure?.liquidityZones && structure.liquidityZones.length > 0) {
    const nearest = structure.liquidityZones.reduce((a, b) =>
      Math.abs(a.price - price) < Math.abs(b.price - price) ? a : b
    );
    features.distance_to_liquidity_pct = Math.abs(price - nearest.price) / price * 100;
    features.liquidity_strength = nearest.strength;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // GROUP 4: Volatility
  // ═══════════════════════════════════════════════════════════════
  
  if (indicators?.atr !== undefined) {
    features.atr = indicators.atr;
    
    // ATR percentile
    if (indicators.atrHistory && indicators.atrHistory.length > 0) {
      const sorted = [...indicators.atrHistory].sort((a, b) => a - b);
      const idx = sorted.findIndex(v => v >= indicators.atr);
      features.atr_percentile = idx / sorted.length;
    }
  }
  
  // Calculate volatility from candles
  const ranges20 = candles.slice(-20).map(c => (c.high - c.low) / c.close);
  const ranges50 = candles.slice(-50).map(c => (c.high - c.low) / c.close);
  
  features.candle_range_mean_20 = mean(ranges20);
  features.candle_range_mean_50 = mean(ranges50);
  features.vol_ratio_20_50 = features.candle_range_mean_50 > 0 
    ? features.candle_range_mean_20 / features.candle_range_mean_50 
    : 1;
  
  // Volatility regime
  const atrPct = indicators?.atr ? indicators.atr / price : features.candle_range_mean_20;
  if (atrPct < 0.01) features.volatility_regime = 0;
  else if (atrPct < 0.025) features.volatility_regime = 1;
  else if (atrPct < 0.05) features.volatility_regime = 2;
  else features.volatility_regime = 3;
  
  // Expanding/compressing
  features.volatility_expanding = features.vol_ratio_20_50 > 1.2 ? 1 : 0;
  features.volatility_compressing = features.vol_ratio_20_50 < 0.8 ? 1 : 0;
  
  // ═══════════════════════════════════════════════════════════════
  // GROUP 5: Momentum
  // ═══════════════════════════════════════════════════════════════
  
  if (indicators?.rsi !== undefined) {
    features.rsi = indicators.rsi / 100; // normalize to 0-1
    features.rsi_slope = indicators.rsiPrev !== undefined
      ? (indicators.rsi - indicators.rsiPrev) / 100
      : 0;
  }
  
  if (indicators?.macd) {
    features.macd_histogram = indicators.macd.histogram;
    features.macd_slope = indicators.macd.histogramPrev !== undefined
      ? indicators.macd.histogram - indicators.macd.histogramPrev
      : 0;
  }
  
  // Price velocity and acceleration
  if (candles.length >= 5) {
    const closes = candles.slice(-5).map(c => c.close);
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    features.price_velocity = mean(returns);
    
    // Acceleration = change in velocity
    if (returns.length >= 2) {
      features.price_acceleration = returns[returns.length - 1] - returns[0];
    }
  }
  
  // Momentum strength (simplified)
  const rsiStr = Math.abs(features.rsi - 0.5) * 2;
  features.momentum_strength = rsiStr;
  
  // Momentum divergence (simplified check)
  features.momentum_divergence = detectDivergence(candles.slice(-20), features.rsi);
  
  // ═══════════════════════════════════════════════════════════════
  // GROUP 6: Volume
  // ═══════════════════════════════════════════════════════════════
  
  const volumes = candles.slice(-20).map(c => c.volume ?? 0).filter(v => v > 0);
  if (volumes.length > 0) {
    const volMean = mean(volumes);
    features.volume_mean_20 = volMean;
    
    const currentVol = candles[candles.length - 1].volume ?? 0;
    features.volume_spike_score = volMean > 0 ? currentVol / volMean : 1;
    
    // Volume trend
    const vol1 = mean(volumes.slice(0, 10));
    const vol2 = mean(volumes.slice(-10));
    if (vol2 > vol1 * 1.1) features.volume_trend = 1;
    else if (vol2 < vol1 * 0.9) features.volume_trend = -1;
    else features.volume_trend = 0;
    
    features.volume_on_breakout = features.volume_spike_score;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // GROUP 7: Market Structure
  // ═══════════════════════════════════════════════════════════════
  
  // Market phase (simplified)
  if (structure?.regime) {
    const regime = structure.regime.toLowerCase();
    if (regime.includes('accum')) features.market_phase = 0;
    else if (regime.includes('up') || regime.includes('mark')) features.market_phase = 1;
    else if (regime.includes('dist')) features.market_phase = 2;
    else if (regime.includes('down') || regime.includes('mark')) features.market_phase = 3;
    else features.market_phase = 1; // default
  }
  
  // Trend vs range
  features.trend_vs_range = features.trend_strength;
  
  // BOS count
  features.bos_count_50 = features.structure_breaks_50;
  
  // CHOCH recency (placeholder)
  features.choch_bars_ago = 50;
  
  // Structure strength
  features.structure_strength = features.trend_strength;
  
  // Swing density
  features.swing_density = features.pivot_density;
  
  // HTF alignment (placeholder - would need higher TF data)
  features.htf_alignment = 0;
  
  // ═══════════════════════════════════════════════════════════════
  // GROUP 8: Risk
  // ═══════════════════════════════════════════════════════════════
  
  if (risk) {
    const entry = risk.entry ?? price;
    const stop = risk.stop ?? price * 0.98;
    const target1 = risk.target1 ?? price * 1.04;
    const target2 = risk.target2;
    
    const stopDist = Math.abs(entry - stop);
    const targetDist = Math.abs(target1 - entry);
    
    features.stop_distance_pct = stopDist / entry * 100;
    features.rr_to_target1 = stopDist > 0 ? targetDist / stopDist : 0;
    
    if (target2) {
      const target2Dist = Math.abs(target2 - entry);
      features.rr_to_target2 = stopDist > 0 ? target2Dist / stopDist : 0;
    }
    
    // Expected duration (based on pattern width)
    features.position_duration_expected = features.pattern_width_bars * 0.5;
    
    // Risk to volatility
    const atr = indicators?.atr ?? (features.candle_range_mean_20 * price);
    features.risk_to_volatility = atr > 0 ? stopDist / atr : 1;
    
    // Entry quality (simplified)
    features.entry_quality = Math.min(1, features.rr_to_target1 / 3);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // GROUP 9: Pattern Reliability
  // ═══════════════════════════════════════════════════════════════
  
  if (reliability) {
    features.pattern_prior_winrate = reliability.patternPrior ?? 0.5;
    features.pattern_winrate_regime = reliability.patternPriorRegime ?? 0.5;
    features.pattern_decay_rate = reliability.patternDecay ?? 0.5;
    features.cluster_density = reliability.clusterDensity ?? 0;
    features.similar_patterns_100 = reliability.similarPatterns ?? 0;
    features.behaviour_probability = reliability.behaviourProb ?? 0.5;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // GROUP 10: Time Features
  // ═══════════════════════════════════════════════════════════════
  
  const ts = timestamp ?? candles[candles.length - 1].ts;
  const date = new Date(ts * 1000);
  
  features.day_of_week = date.getUTCDay() / 6; // normalize 0-1
  features.month = date.getUTCMonth() / 11; // normalize 0-1
  
  // Session type (simplified by hour)
  const hour = date.getUTCHours();
  if (hour >= 0 && hour < 8) features.session_type = 0; // Asian
  else if (hour >= 8 && hour < 16) features.session_type = 1; // European
  else features.session_type = 2; // American
  
  features.bar_index_in_trend = Math.min(1, features.trend_duration_bars / 100);
  
  return features;
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function countStructureBreaks(candles: Candle[]): number {
  if (candles.length < 5) return 0;
  
  let breaks = 0;
  let lastHigh = candles[0].high;
  let lastLow = candles[0].low;
  
  for (let i = 5; i < candles.length; i++) {
    const high = Math.max(...candles.slice(i - 5, i).map(c => c.high));
    const low = Math.min(...candles.slice(i - 5, i).map(c => c.low));
    
    if (candles[i].close > lastHigh) {
      breaks++;
      lastHigh = high;
    }
    if (candles[i].close < lastLow) {
      breaks++;
      lastLow = low;
    }
  }
  
  return breaks;
}

function calculatePriorSwing(candles: Candle[], currentPrice: number): number {
  if (candles.length < 10) return 0;
  
  const high = Math.max(...candles.map(c => c.high));
  const low = Math.min(...candles.map(c => c.low));
  
  return ((high - low) / currentPrice) * 100;
}

function detectDivergence(candles: Candle[], rsi: number): number {
  if (candles.length < 10) return 0;
  
  const priceSlope = (candles[candles.length - 1].close - candles[0].close) / candles[0].close;
  
  // Simplified: if price going up but RSI < 0.5, potential bearish divergence
  // If price going down but RSI > 0.5, potential bullish divergence
  if (priceSlope > 0.02 && rsi < 0.45) return -1; // bearish divergence
  if (priceSlope < -0.02 && rsi > 0.55) return 1; // bullish divergence
  
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// BATCH EXTRACTION
// ═══════════════════════════════════════════════════════════════

export function extractFeaturesBatch(inputs: ExtractorInputV2[]): MLFeaturesV2[] {
  return inputs.map(input => extractFeaturesV2(input));
}
