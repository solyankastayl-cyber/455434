/**
 * Phase R: Pattern Detectors Main Index
 * Central entry point for all pattern detection
 */

import { PatternInput, PatternResult, Pivot } from './utils/pattern_types.js';
import { runStructureDetectors } from './structure/index.js';
import { runBreakoutDetectors } from './breakouts/index.js';
import { runTriangleDetectors } from './triangles/index.js';
import { runReversalDetectors } from './reversals/index.js';
import { runHarmonicDetectors } from './harmonics/index.js';
import { runCandleDetectors } from './candles/index.js';
import { runMarketStructureDetectors } from './market_structure/index.js';
import { findAllPivots } from './utils/swing_points.js';

export interface PatternEngineConfig {
  enableStructure?: boolean;
  enableBreakouts?: boolean;
  enableTriangles?: boolean;
  enableReversals?: boolean;
  enableHarmonics?: boolean;
  enableCandles?: boolean;
  enableMarketStructure?: boolean;
}

const defaultConfig: PatternEngineConfig = {
  enableStructure: true,
  enableBreakouts: true,
  enableTriangles: true,
  enableReversals: true,
  enableHarmonics: true,
  enableCandles: true,
  enableMarketStructure: true,
};

/**
 * Run all pattern detectors on input data
 */
export function runAllPatternDetectors(
  input: PatternInput,
  config: PatternEngineConfig = defaultConfig
): PatternResult[] {
  const results: PatternResult[] = [];
  
  // Generate pivots if not provided
  const pivots = input.pivots || findAllPivots(input.candles, 5);
  const inputWithPivots = { ...input, pivots };
  
  // Calculate tolY (tolerance for geometric patterns)
  const avgPrice = input.candles.reduce((s, c) => s + c.c, 0) / input.candles.length;
  const tolY = avgPrice * 0.005; // 0.5% tolerance
  
  // Derive levels if not provided
  const levels = input.levels || deriveKeyLevels(input.candles, pivots);
  
  // Run each detector group
  if (config.enableStructure !== false) {
    results.push(...runStructureDetectors(inputWithPivots));
  }
  
  if (config.enableBreakouts !== false) {
    results.push(...runBreakoutDetectors(inputWithPivots, levels));
  }
  
  if (config.enableTriangles !== false) {
    results.push(...runTriangleDetectors(inputWithPivots, pivots, tolY));
  }
  
  if (config.enableReversals !== false) {
    results.push(...runReversalDetectors(inputWithPivots));
  }
  
  if (config.enableHarmonics !== false) {
    results.push(...runHarmonicDetectors(inputWithPivots));
  }
  
  if (config.enableCandles !== false) {
    results.push(...runCandleDetectors(inputWithPivots));
  }
  
  if (config.enableMarketStructure !== false) {
    results.push(...runMarketStructureDetectors(inputWithPivots));
  }
  
  // Sort by confidence (highest first)
  results.sort((a, b) => b.confidence - a.confidence);
  
  return results;
}

/**
 * Derive key price levels from pivots
 */
function deriveKeyLevels(candles: PatternInput['candles'], pivots: Pivot[]): number[] {
  const levels: number[] = [];
  
  // Recent high and low
  const recentCandles = candles.slice(-50);
  const recentHigh = Math.max(...recentCandles.map(c => c.h));
  const recentLow = Math.min(...recentCandles.map(c => c.l));
  
  levels.push(recentHigh, recentLow);
  
  // Pivot levels
  for (const pivot of pivots.slice(-10)) {
    levels.push(pivot.price);
  }
  
  // Round numbers (psychological levels)
  const currentPrice = candles[candles.length - 1]?.c || 0;
  if (currentPrice > 0) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)));
    const roundLevel = Math.round(currentPrice / magnitude) * magnitude;
    levels.push(roundLevel);
  }
  
  // Dedupe and sort
  return Array.from(new Set(levels)).sort((a, b) => b - a);
}

// Re-exports
export * from './utils/index.js';
export * from './pattern_registry.js';
export * from './pattern_meta.js';
export * from './pattern_groups.js';

export {
  runStructureDetectors,
  runBreakoutDetectors,
  runTriangleDetectors,
  runReversalDetectors,
  runHarmonicDetectors,
  runCandleDetectors,
  runMarketStructureDetectors,
};
