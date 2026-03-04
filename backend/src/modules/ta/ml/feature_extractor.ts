/**
 * Phase W: Feature Extractor
 * 
 * Converts TA engine output to ML feature vector.
 */

import { MLFeatures, createEmptyFeatures } from './feature_schema.js';

// Pattern family mappings
const PATTERN_FAMILIES: Record<string, string> = {
  ASCENDING_TRIANGLE: 'triangles',
  DESCENDING_TRIANGLE: 'triangles',
  SYMMETRIC_TRIANGLE: 'triangles',
  DIAMOND_TOP: 'triangles',
  DIAMOND_BOTTOM: 'triangles',
  
  BULL_FLAG: 'flags',
  BEAR_FLAG: 'flags',
  BULL_PENNANT: 'flags',
  BEAR_PENNANT: 'flags',
  
  DOUBLE_TOP: 'reversals',
  DOUBLE_BOTTOM: 'reversals',
  HEAD_SHOULDERS: 'reversals',
  INV_HEAD_SHOULDERS: 'reversals',
  
  HARMONIC_GARTLEY: 'harmonics',
  HARMONIC_BAT: 'harmonics',
  HARMONIC_BUTTERFLY: 'harmonics',
  HARMONIC_CRAB: 'harmonics',
  HARMONIC_ABCD_BULL: 'harmonics',
  HARMONIC_ABCD_BEAR: 'harmonics',
  
  DOJI: 'candles',
  HAMMER: 'candles',
  INVERTED_HAMMER: 'candles',
  ENGULFING_BULL: 'candles',
  ENGULFING_BEAR: 'candles',
  MORNING_STAR: 'candles',
  EVENING_STAR: 'candles',
  
  LIQUIDITY_SWEEP_HIGH: 'liquidity',
  LIQUIDITY_SWEEP_LOW: 'liquidity',
  EQH: 'liquidity',
  EQL: 'liquidity',
  
  ELLIOTT_5_WAVE: 'elliott',
  ELLIOTT_ABC: 'elliott',
  
  DIVERGENCE_BULL: 'divergences',
  DIVERGENCE_BEAR: 'divergences',
  HIDDEN_DIVERGENCE_BULL: 'divergences',
  HIDDEN_DIVERGENCE_BEAR: 'divergences',
  
  BOS_BULL: 'structure',
  BOS_BEAR: 'structure',
  CHOCH_BULL: 'structure',
  CHOCH_BEAR: 'structure',
  
  MA_CROSS_GOLDEN: 'ma',
  MA_CROSS_DEATH: 'ma',
  MA_REJECTION_BULL: 'ma',
  MA_REJECTION_BEAR: 'ma',
  MA_SQUEEZE: 'ma',
};

export interface ExtractorInput {
  run?: any;
  scenario?: any;
  patterns?: any[];
  riskPack?: any;
  reliability?: any;
  confluence?: any;
  structure?: any;
  vol?: any;
}

/**
 * Extract ML features from TA engine output
 */
export function extractFeatures(input: ExtractorInput): MLFeatures {
  const features = createEmptyFeatures();
  
  const { run, scenario, patterns = [], riskPack, reliability, confluence, structure, vol } = input;

  // ═══════════════════════════════════════════════════════════════
  // GROUP A: Scenario Core
  // ═══════════════════════════════════════════════════════════════
  
  if (scenario) {
    features.scenarioScore = scenario.score ?? 0;
    features.effectiveScore = scenario.effectiveScore ?? scenario.score ?? 0;
    features.baselineProb = scenario.probability ?? 0.5;
    
    // Top bias
    const bias = scenario.bias || scenario.direction || 'NEUTRAL';
    features.topBias = bias === 'BULL' ? 1 : bias === 'BEAR' ? -1 : 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // GROUP B: Market Regime
  // ═══════════════════════════════════════════════════════════════
  
  const regime = structure?.regime || run?.regime || 'RANGE';
  features.regime_UP = regime === 'TREND_UP' || regime === 'UP' ? 1 : 0;
  features.regime_DOWN = regime === 'TREND_DOWN' || regime === 'DOWN' ? 1 : 0;
  features.regime_RANGE = regime === 'RANGE' ? 1 : 0;
  features.regime_TRANSITION = regime === 'TRANSITION' ? 1 : 0;
  
  const volRegime = vol?.regime || 'NORMAL';
  features.vol_LOW = volRegime === 'LOW' ? 1 : 0;
  features.vol_NORMAL = volRegime === 'NORMAL' ? 1 : 0;
  features.vol_HIGH = volRegime === 'HIGH' ? 1 : 0;
  features.vol_EXTREME = volRegime === 'EXTREME' ? 1 : 0;

  // ═══════════════════════════════════════════════════════════════
  // GROUP C: Pattern Composition
  // ═══════════════════════════════════════════════════════════════
  
  const familyCounts: Record<string, number> = {};
  const familyBestScores: Record<string, number> = {};
  const uniqueTypes = new Set<string>();
  
  for (const pattern of patterns) {
    const type = pattern.type || '';
    const family = PATTERN_FAMILIES[type] || 'other';
    const score = pattern.metrics?.totalScore ?? pattern.score ?? 0.5;
    
    uniqueTypes.add(type);
    familyCounts[family] = (familyCounts[family] || 0) + 1;
    familyBestScores[family] = Math.max(familyBestScores[family] || 0, score);
  }
  
  features.patterns_triangles = familyCounts['triangles'] || 0;
  features.patterns_flags = familyCounts['flags'] || 0;
  features.patterns_reversals = familyCounts['reversals'] || 0;
  features.patterns_harmonics = familyCounts['harmonics'] || 0;
  features.patterns_candles = familyCounts['candles'] || 0;
  features.patterns_liquidity = familyCounts['liquidity'] || 0;
  features.patterns_elliott = familyCounts['elliott'] || 0;
  features.patterns_divergences = familyCounts['divergences'] || 0;
  features.patterns_structure = familyCounts['structure'] || 0;
  features.patterns_ma = familyCounts['ma'] || 0;
  
  features.best_triangle_score = familyBestScores['triangles'] || 0;
  features.best_flag_score = familyBestScores['flags'] || 0;
  features.best_reversal_score = familyBestScores['reversals'] || 0;
  features.best_harmonic_score = familyBestScores['harmonics'] || 0;
  features.best_candle_score = familyBestScores['candles'] || 0;
  features.best_liquidity_score = familyBestScores['liquidity'] || 0;
  features.best_divergence_score = familyBestScores['divergences'] || 0;
  
  features.total_patterns = patterns.length;
  features.unique_pattern_types = uniqueTypes.size;

  // ═══════════════════════════════════════════════════════════════
  // GROUP D: Confluence Factors
  // ═══════════════════════════════════════════════════════════════
  
  if (confluence) {
    features.ma_alignment = confluence.maAlignment ? 1 : 0;
    features.fib_confluence = confluence.fibConfluence ? 1 : 0;
    features.structure_support = confluence.structureSupport ? 1 : 0;
    features.sr_proximity = confluence.srProximity ? 1 : 0;
    features.volatility_gate = confluence.volatilityGate ?? 0;
    
    features.conflict_hard_count = confluence.conflicts?.hard?.length ?? 0;
    features.conflict_soft_count = confluence.conflicts?.soft?.length ?? 0;
    features.confluence_bonus_total = confluence.bonusTotal ?? 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // GROUP E: Risk Pack
  // ═══════════════════════════════════════════════════════════════
  
  if (riskPack) {
    features.rrToT1 = riskPack.rrToT1 ?? riskPack.rr ?? 0;
    features.rrToT2 = riskPack.rrToT2 ?? (riskPack.rr ? riskPack.rr * 1.5 : 0);
    features.riskPct = riskPack.riskPct ?? 0;
    features.rewardPct = riskPack.rewardPct ?? 0;
    features.entryDistATR = riskPack.entryDistATR ?? 0;
    features.stopDistATR = riskPack.stopDistATR ?? 0;
    features.targetDistATR = riskPack.targetDistATR ?? 0;
    
    const entryType = riskPack.entryType || 'MARKET';
    features.entry_BREAKOUT = entryType === 'BREAKOUT' ? 1 : 0;
    features.entry_RETEST = entryType === 'RETEST' ? 1 : 0;
    features.entry_MARKET = entryType === 'MARKET' ? 1 : 0;
    features.entry_LIMIT = entryType === 'LIMIT' ? 1 : 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // GROUP F: Reliability Priors
  // ═══════════════════════════════════════════════════════════════
  
  if (reliability) {
    features.patternPrior = reliability.prior ?? 0.5;
    features.patternPriorDecay = reliability.priorDecay ?? reliability.prior ?? 0.5;
    features.clusterStrength = reliability.clusterScore ?? 0;
    features.avgPatternReliability = reliability.avgReliability ?? 0.5;
  }

  return features;
}

/**
 * Convert features to flat array for ML
 */
export function featuresToArray(features: MLFeatures): number[] {
  return [
    features.scenarioScore,
    features.effectiveScore,
    features.baselineProb,
    features.topBias,
    features.regime_UP,
    features.regime_DOWN,
    features.regime_RANGE,
    features.regime_TRANSITION,
    features.vol_LOW,
    features.vol_NORMAL,
    features.vol_HIGH,
    features.vol_EXTREME,
    features.patterns_triangles,
    features.patterns_flags,
    features.patterns_reversals,
    features.patterns_harmonics,
    features.patterns_candles,
    features.patterns_liquidity,
    features.patterns_elliott,
    features.patterns_divergences,
    features.patterns_structure,
    features.patterns_ma,
    features.best_triangle_score,
    features.best_flag_score,
    features.best_reversal_score,
    features.best_harmonic_score,
    features.best_candle_score,
    features.best_liquidity_score,
    features.best_divergence_score,
    features.total_patterns,
    features.unique_pattern_types,
    features.ma_alignment,
    features.fib_confluence,
    features.structure_support,
    features.sr_proximity,
    features.volatility_gate,
    features.conflict_hard_count,
    features.conflict_soft_count,
    features.confluence_bonus_total,
    features.rrToT1,
    features.rrToT2,
    features.riskPct,
    features.rewardPct,
    features.entryDistATR,
    features.stopDistATR,
    features.targetDistATR,
    features.entry_BREAKOUT,
    features.entry_RETEST,
    features.entry_MARKET,
    features.entry_LIMIT,
    features.patternPrior,
    features.patternPriorDecay,
    features.clusterStrength,
    features.avgPatternReliability,
  ];
}
