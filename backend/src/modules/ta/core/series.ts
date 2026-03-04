/**
 * TAContext Builder — Unified context assembly
 * 
 * Single entry point for building TA context.
 * All detectors receive pre-computed TAContext.
 * 
 * Phase 7: Added Feature Pack integration
 */

import { Series, TAContext, TAEngineConfig, DEFAULT_TA_CONFIG } from '../domain/types.js';
import { computeATR, computeLogPrice, computeReturns, computeSMA, computeSlope } from './indicators.js';
import { computePivotsZigZagATR } from './pivots.js';
import { computeMarketStructure } from './structure.js';
import { computeLevels } from './levels.js';
import { applyFeaturePack } from '../features/features.builder.js';

/**
 * Build complete TA context from series data
 * 
 * This is the main entry point for TA analysis.
 * Returns a fully-populated TAContext that detectors can use.
 */
export function buildTAContext(
  series: Series,
  cfg: TAEngineConfig = DEFAULT_TA_CONFIG
): TAContext {
  const candles = series.candles;
  
  if (candles.length === 0) {
    return createEmptyContext(series);
  }

  // ════════════════════════════════════════════════════
  // Core Indicators
  // ════════════════════════════════════════════════════
  
  const returns1d = computeReturns(candles);
  const logPrice = computeLogPrice(candles);
  const atr = computeATR(candles, cfg.atrPeriod);

  // Moving Averages
  const closes = candles.map(c => c.close);
  const ma50 = computeSMA(closes, 50);
  const ma200 = computeSMA(closes, 200);
  const maSlope50 = computeSlope(ma50, 10);
  const maSlope200 = computeSlope(ma200, 20);

  // ════════════════════════════════════════════════════
  // Core Geometry
  // ════════════════════════════════════════════════════
  
  // Pivots (ATR-adaptive ZigZag)
  const pivots = computePivotsZigZagATR(candles, atr, cfg.pivot);
  
  // Market Structure
  const structure = computeMarketStructure(pivots, cfg.structure);
  
  // Support/Resistance Levels
  const levels = computeLevels(candles, pivots, atr, cfg.levels);

  // ════════════════════════════════════════════════════
  // Universal Features (for detectors & ML)
  // ════════════════════════════════════════════════════
  
  const lastIdx = candles.length - 1;
  const currentPrice = closes[lastIdx];
  const currentATR = atr[lastIdx];
  
  const features: Record<string, number> = {
    // Structure features
    hhhlScore: structure.hhhlScore,
    compressionScore: structure.compressionScore,
    
    // MA features
    maSlope50: maSlope50[lastIdx] ?? 0,
    maSlope200: maSlope200[lastIdx] ?? 0,
    priceVsMa50: ma50[lastIdx] > 0 ? currentPrice / ma50[lastIdx] - 1 : 0,
    priceVsMa200: ma200[lastIdx] > 0 ? currentPrice / ma200[lastIdx] - 1 : 0,
    ma50VsMa200: ma200[lastIdx] > 0 ? ma50[lastIdx] / ma200[lastIdx] - 1 : 0,
    
    // Volatility features
    atr: currentATR,
    atrPct: currentPrice > 0 ? currentATR / currentPrice : 0,
    
    // Level features
    levelsCount: levels.length,
    nearestSupportDist: 0,  // will calculate below
    nearestResistanceDist: 0,
    
    // Pivot features
    pivotsCount: pivots.length,
    avgPivotStrength: pivots.length > 0 ? pivots.reduce((s, p) => s + p.strength, 0) / pivots.length : 0,
  };
  
  // Calculate distance to nearest levels
  const nearestSupport = levels.find(l => (l.type === "SUPPORT" || l.type === "BOTH") && l.price < currentPrice);
  const nearestResistance = levels.find(l => (l.type === "RESISTANCE" || l.type === "BOTH") && l.price > currentPrice);
  
  if (nearestSupport) {
    features.nearestSupportDist = (currentPrice - nearestSupport.price) / currentPrice;
  }
  if (nearestResistance) {
    features.nearestResistanceDist = (nearestResistance.price - currentPrice) / currentPrice;
  }

  // ════════════════════════════════════════════════════
  // Phase 7: Build Feature Pack
  // ════════════════════════════════════════════════════
  
  const baseCtx: TAContext = {
    series,
    atr,
    returns1d,
    logPrice,
    ma50,
    ma200,
    maSlope50,
    maSlope200,
    pivots,
    structure,
    levels,
    features,
  };

  // Apply Feature Pack (adds featuresPack and extends features)
  return applyFeaturePack(baseCtx);
}

/**
 * Create empty context for edge cases
 */
function createEmptyContext(series: Series): TAContext {
  return {
    series,
    atr: [],
    returns1d: [],
    logPrice: [],
    ma50: [],
    ma200: [],
    maSlope50: [],
    maSlope200: [],
    pivots: [],
    structure: {
      regime: "TRANSITION",
      hhhlScore: 0,
      compressionScore: 0,
    },
    levels: [],
    features: {},
  };
}

/**
 * Extract MA context for pattern detection
 */
export function extractMAContext(ctx: TAContext): {
  priceVsMa50: number;
  priceVsMa200: number;
  ma50VsMa200: number;
  maSlope50: number;
  maSlope200: number;
} {
  const lastIdx = ctx.series.candles.length - 1;
  
  return {
    priceVsMa50: ctx.features.priceVsMa50 ?? 0,
    priceVsMa200: ctx.features.priceVsMa200 ?? 0,
    ma50VsMa200: ctx.features.ma50VsMa200 ?? 0,
    maSlope50: ctx.maSlope50[lastIdx] ?? 0,
    maSlope200: ctx.maSlope200[lastIdx] ?? 0,
  };
}

/**
 * Get current market regime string
 */
export function getRegimeLabel(ctx: TAContext): string {
  const { regime, hhhlScore, compressionScore } = ctx.structure;
  
  let label = regime;
  
  if (regime === "TREND_UP") {
    label = hhhlScore >= 0.8 ? "STRONG_UPTREND" : "UPTREND";
  } else if (regime === "TREND_DOWN") {
    label = hhhlScore <= -0.8 ? "STRONG_DOWNTREND" : "DOWNTREND";
  } else if (compressionScore > 0.7) {
    label = "CONSOLIDATION";
  }
  
  return label;
}
