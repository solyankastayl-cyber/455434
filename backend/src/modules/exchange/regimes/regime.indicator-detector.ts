/**
 * S10.6I.7 — Indicator-driven Regime Detector
 * 
 * Detects market regimes ONLY using Indicators Layer.
 * NO raw price/volume deltas — ONLY indicators and aggregates.
 * 
 * PRINCIPLES:
 * - Regime = state of indicator system
 * - Regime ≠ price change
 * - Drivers explain why regime was chosen
 */

import { MarketRegime } from './regime.types.js';
import { StoredIndicatorValue } from '../observation/observation.types.js';
import {
  MarketAggregates,
  computeMarketAggregates,
  isAccumulationCondition,
  isExhaustionCondition,
  isSqueezeCondition,
  isExpansionCondition,
  isDistributionCondition,
} from '../indicators/indicator.aggregates.js';

// ═══════════════════════════════════════════════════════════════
// INDICATOR-DRIVEN REGIME RESULT
// ═══════════════════════════════════════════════════════════════

export interface IndicatorDrivenRegime {
  regime: MarketRegime;
  confidence: number;
  drivers: string[];
  aggregates: MarketAggregates;
  indicatorsUsed: string[];
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Get indicator
// ═══════════════════════════════════════════════════════════════

function getIndicator(
  indicators: Record<string, StoredIndicatorValue>,
  id: string,
  defaultValue: number = 0
): number {
  const ind = indicators[id];
  if (!ind || typeof ind.value !== 'number' || isNaN(ind.value)) {
    return defaultValue;
  }
  return ind.value;
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Detect regime from indicators
// ═══════════════════════════════════════════════════════════════

export function detectIndicatorDrivenRegime(
  indicators: Record<string, StoredIndicatorValue>
): IndicatorDrivenRegime {
  // Compute aggregates
  const agg = computeMarketAggregates(indicators);
  
  // If no indicators, return NEUTRAL
  if (!agg.computed || agg.indicatorCount < 10) {
    return {
      regime: 'NEUTRAL',
      confidence: 0,
      drivers: ['insufficient_indicators'],
      aggregates: agg,
      indicatorsUsed: [],
    };
  }
  
  // Collect all used indicators
  const indicatorsUsed = Object.keys(indicators);
  
  // ─────────────────────────────────────────────────────────────
  // REGIME DETECTION (priority order)
  // ─────────────────────────────────────────────────────────────
  
  // 1. SQUEEZE (highest priority — dangerous state)
  const squeezeResult = evaluateSqueeze(indicators, agg);
  if (squeezeResult.detected) {
    return {
      regime: squeezeResult.direction === 'LONG' ? 'LONG_SQUEEZE' : 'SHORT_SQUEEZE',
      confidence: squeezeResult.confidence,
      drivers: squeezeResult.drivers,
      aggregates: agg,
      indicatorsUsed,
    };
  }
  
  // 2. EXHAUSTION (momentum dying)
  const exhaustionResult = evaluateExhaustion(indicators, agg);
  if (exhaustionResult.detected) {
    return {
      regime: 'EXHAUSTION',
      confidence: exhaustionResult.confidence,
      drivers: exhaustionResult.drivers,
      aggregates: agg,
      indicatorsUsed,
    };
  }
  
  // 3. EXPANSION (strong directional move)
  const expansionResult = evaluateExpansion(indicators, agg);
  if (expansionResult.detected) {
    return {
      regime: 'EXPANSION',
      confidence: expansionResult.confidence,
      drivers: expansionResult.drivers,
      aggregates: agg,
      indicatorsUsed,
    };
  }
  
  // 4. DISTRIBUTION (positions unwinding)
  const distributionResult = evaluateDistribution(indicators, agg);
  if (distributionResult.detected) {
    return {
      regime: 'DISTRIBUTION',
      confidence: distributionResult.confidence,
      drivers: distributionResult.drivers,
      aggregates: agg,
      indicatorsUsed,
    };
  }
  
  // 5. ACCUMULATION (quiet building)
  const accumulationResult = evaluateAccumulation(indicators, agg);
  if (accumulationResult.detected) {
    return {
      regime: 'ACCUMULATION',
      confidence: accumulationResult.confidence,
      drivers: accumulationResult.drivers,
      aggregates: agg,
      indicatorsUsed,
    };
  }
  
  // 6. NEUTRAL (default)
  return {
    regime: 'NEUTRAL',
    confidence: 0.5,
    drivers: ['no_clear_regime'],
    aggregates: agg,
    indicatorsUsed,
  };
}

// ═══════════════════════════════════════════════════════════════
// REGIME EVALUATORS (Indicator-driven)
// ═══════════════════════════════════════════════════════════════

interface RegimeEvaluation {
  detected: boolean;
  confidence: number;
  drivers: string[];
  direction?: 'LONG' | 'SHORT';
}

// ─────────────────────────────────────────────────────────────
// SQUEEZE (Indicator-driven)
// Conditions:
// - PCI > 0.7 (high crowding)
// - marketStress > 0.6
// - LVI > 0.5 (liquidity vacuum)
// - Direction from FRP + LSR + OBI
// ─────────────────────────────────────────────────────────────

function evaluateSqueeze(
  indicators: Record<string, StoredIndicatorValue>,
  agg: MarketAggregates
): RegimeEvaluation {
  const drivers: string[] = [];
  let score = 0;
  
  // Crowding check
  if (agg.positionCrowding > 0.7) {
    score += 0.3;
    drivers.push('crowding_high');
  }
  
  // Stress check
  if (agg.marketStress > 0.6) {
    score += 0.25;
    drivers.push('market_stressed');
  }
  
  // Liquidity vacuum
  const lvi = getIndicator(indicators, 'liquidity_vacuum', 0.5);
  if (lvi > 0.5) {
    score += 0.2;
    drivers.push('liquidity_vacuum');
  }
  
  // Direction determination
  const frp = getIndicator(indicators, 'funding_pressure', 0);
  const lsr = getIndicator(indicators, 'long_short_ratio', 0);
  const obi = getIndicator(indicators, 'book_imbalance', 0);
  
  const directionScore = frp * 0.4 + lsr * 0.4 + obi * 0.2;
  const direction: 'LONG' | 'SHORT' = directionScore > 0 ? 'LONG' : 'SHORT';
  
  if (Math.abs(directionScore) > 0.3) {
    score += 0.25;
    drivers.push(direction === 'LONG' ? 'longs_crowded' : 'shorts_crowded');
  }
  
  return {
    detected: score >= 0.6,
    confidence: Math.min(0.95, score),
    drivers,
    direction,
  };
}

// ─────────────────────────────────────────────────────────────
// EXHAUSTION (Indicator-driven)
// Conditions:
// - MomentumDecay > 0.6 (or MDI < 0.6)
// - Participation < 0.4
// - AbsorptionStrength > 0.5
// - RSI extreme but fading
// ─────────────────────────────────────────────────────────────

function evaluateExhaustion(
  indicators: Record<string, StoredIndicatorValue>,
  agg: MarketAggregates
): RegimeEvaluation {
  const drivers: string[] = [];
  let score = 0;
  
  // Momentum decay check
  const momentumDecay = getIndicator(indicators, 'momentum_decay', 1);
  if (momentumDecay < 0.6) {
    score += 0.3;
    drivers.push('momentum_decaying');
  }
  
  // Low participation
  if (agg.participation < 0.4) {
    score += 0.25;
    drivers.push('low_participation');
  }
  
  // High absorption (price not moving despite flow)
  const absStrength = getIndicator(indicators, 'absorption_strength', 0.5);
  if (absStrength > 0.5) {
    score += 0.2;
    drivers.push('high_absorption');
  }
  
  // Volume vs Price Response (low = exhaustion)
  const vpr = getIndicator(indicators, 'volume_price_response', 0.5);
  if (vpr < 0.3) {
    score += 0.15;
    drivers.push('price_not_responding');
  }
  
  // RSI check for extreme
  const rsi = getIndicator(indicators, 'rsi_normalized', 0);
  if (Math.abs(rsi) > 0.6) {
    score += 0.1;
    drivers.push(rsi > 0 ? 'rsi_extreme_high' : 'rsi_extreme_low');
  }
  
  return {
    detected: score >= 0.5,
    confidence: Math.min(0.9, score),
    drivers,
  };
}

// ─────────────────────────────────────────────────────────────
// EXPANSION (Indicator-driven)
// Conditions:
// - structureState > 0.5 OR < -0.5 (clear direction)
// - momentumState confirms direction
// - Participation > 0.5
// - Range expanding (RCI > 1.3)
// ─────────────────────────────────────────────────────────────

function evaluateExpansion(
  indicators: Record<string, StoredIndicatorValue>,
  agg: MarketAggregates
): RegimeEvaluation {
  const drivers: string[] = [];
  let score = 0;
  
  // Clear structure direction
  if (Math.abs(agg.structureState) > 0.5) {
    score += 0.3;
    drivers.push(agg.structureState > 0 ? 'bullish_structure' : 'bearish_structure');
  }
  
  // Momentum confirms
  const momentumAligned = (agg.structureState > 0 && agg.momentumState > 0.3) ||
                          (agg.structureState < 0 && agg.momentumState < -0.3);
  if (momentumAligned) {
    score += 0.25;
    drivers.push('momentum_aligned');
  }
  
  // Good participation
  if (agg.participation > 0.5) {
    score += 0.2;
    drivers.push('healthy_participation');
  }
  
  // Range expansion
  const rci = getIndicator(indicators, 'range_compression', 1);
  if (rci > 1.3) {
    score += 0.15;
    drivers.push('range_expanding');
  }
  
  // Trend slope confirms
  const trendSlope = getIndicator(indicators, 'trend_slope', 0);
  if (Math.abs(trendSlope) > 0.3) {
    score += 0.1;
    drivers.push('trend_active');
  }
  
  return {
    detected: score >= 0.55,
    confidence: Math.min(0.9, score),
    drivers,
  };
}

// ─────────────────────────────────────────────────────────────
// DISTRIBUTION (Indicator-driven)
// Conditions:
// - Participation declining (< 0.4)
// - OI_Level high but OI_Delta negative
// - Crowding > 0.5 but decreasing
// - Low absorption
// ─────────────────────────────────────────────────────────────

function evaluateDistribution(
  indicators: Record<string, StoredIndicatorValue>,
  agg: MarketAggregates
): RegimeEvaluation {
  const drivers: string[] = [];
  let score = 0;
  
  // Low/declining participation
  if (agg.participation < 0.4) {
    score += 0.25;
    drivers.push('weak_participation');
  }
  
  // OI high but declining
  const oiLevel = getIndicator(indicators, 'oi_level', 0);
  const oiDelta = getIndicator(indicators, 'oi_delta', 0);
  
  if (oiLevel > 0.3 && oiDelta < -0.2) {
    score += 0.3;
    drivers.push('oi_unwinding');
  }
  
  // Crowding present
  if (agg.positionCrowding > 0.5) {
    score += 0.2;
    drivers.push('positions_crowded');
  }
  
  // Low absorption (no one catching)
  const absStrength = getIndicator(indicators, 'absorption_strength', 0.5);
  if (absStrength < 0.4) {
    score += 0.15;
    drivers.push('low_absorption');
  }
  
  // Volume delta negative
  const volumeDelta = getIndicator(indicators, 'volume_delta', 0);
  if (volumeDelta < -0.2) {
    score += 0.1;
    drivers.push('selling_pressure');
  }
  
  return {
    detected: score >= 0.5,
    confidence: Math.min(0.85, score),
    drivers,
  };
}

// ─────────────────────────────────────────────────────────────
// ACCUMULATION (Indicator-driven)
// Conditions:
// - Participation > 0.6
// - Structure stable (|structureState| < 0.3)
// - Range compressed (RCI < 0.7)
// - OI_Delta positive
// - Volume absorption high
// ─────────────────────────────────────────────────────────────

function evaluateAccumulation(
  indicators: Record<string, StoredIndicatorValue>,
  agg: MarketAggregates
): RegimeEvaluation {
  const drivers: string[] = [];
  let score = 0;
  
  // High participation
  if (agg.participation > 0.6) {
    score += 0.3;
    drivers.push('strong_participation');
  }
  
  // Stable structure (range-bound)
  if (Math.abs(agg.structureState) < 0.3) {
    score += 0.2;
    drivers.push('stable_structure');
  }
  
  // Range compressed
  const rci = getIndicator(indicators, 'range_compression', 1);
  if (rci < 0.7) {
    score += 0.2;
    drivers.push('range_compressed');
  }
  
  // OI growing
  const oiDelta = getIndicator(indicators, 'oi_delta', 0);
  if (oiDelta > 0.3) {
    score += 0.15;
    drivers.push('oi_building');
  }
  
  // High absorption
  const absStrength = getIndicator(indicators, 'absorption_strength', 0.5);
  if (absStrength > 0.6) {
    score += 0.15;
    drivers.push('high_absorption');
  }
  
  return {
    detected: score >= 0.5,
    confidence: Math.min(0.85, score),
    drivers,
  };
}

console.log('[S10.6I.7] Indicator-driven Regime Detector loaded');
