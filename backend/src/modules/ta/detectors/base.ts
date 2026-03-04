/**
 * Base Detector — Abstract interface for all pattern detectors
 * 
 * All pattern detectors must implement the Detector interface.
 * This file provides utilities for detector implementation.
 */

import { TAContext, CandidatePattern, PatternType, Detector, MarketRegime } from '../domain/types.js';
import { generateId } from '../domain/math.js';
import { extractMAContext } from '../core/series.js';

/**
 * Create a candidate pattern with common fields pre-filled
 */
export function createCandidatePattern(
  ctx: TAContext,
  type: PatternType,
  direction: "BULLISH" | "BEARISH" | "NEUTRAL",
  startIdx: number,
  endIdx: number,
  geometry: CandidatePattern["geometry"],
  metrics: Omit<CandidatePattern["metrics"], "totalScore">,
  trade?: CandidatePattern["trade"]
): CandidatePattern {
  const candles = ctx.series.candles;
  const lastIdx = candles.length - 1;
  
  // Calculate total score (weighted)
  const totalScore = (
    metrics.geometryScore * 0.25 +
    metrics.touchScore * 0.25 +
    metrics.symmetryScore * 0.15 +
    metrics.durationScore * 0.15 +
    metrics.noiseScore * 0.10 +
    (metrics.volumeScore ?? 0.5) * 0.10
  );
  
  return {
    id: generateId('pattern'),
    type,
    tf: ctx.series.tf,
    asset: ctx.series.asset,
    startTs: candles[startIdx].ts,
    endTs: candles[endIdx].ts,
    startIdx,
    endIdx,
    direction,
    geometry,
    metrics: {
      ...metrics,
      totalScore: Math.round(totalScore * 100) / 100,
    },
    context: {
      regime: ctx.structure.regime,
      atr: ctx.atr[lastIdx],
      currentPrice: candles[lastIdx].close,
      maContext: extractMAContext(ctx),
    },
    trade,
  };
}

/**
 * Calculate pattern duration score
 * Optimal duration depends on pattern type
 */
export function calculateDurationScore(
  bars: number,
  optimalMin: number,
  optimalMax: number
): number {
  if (bars < optimalMin * 0.5) return 0.2;
  if (bars > optimalMax * 2) return 0.3;
  if (bars >= optimalMin && bars <= optimalMax) return 1.0;
  
  if (bars < optimalMin) {
    return 0.5 + 0.5 * (bars / optimalMin);
  }
  return 0.7 - 0.4 * ((bars - optimalMax) / optimalMax);
}

/**
 * Calculate noise score (inverse of price choppiness)
 */
export function calculateNoiseScore(ctx: TAContext, startIdx: number, endIdx: number): number {
  const candles = ctx.series.candles.slice(startIdx, endIdx + 1);
  if (candles.length < 2) return 0.5;
  
  const atr = ctx.atr.slice(startIdx, endIdx + 1);
  let sumDeviation = 0;
  
  for (let i = 1; i < candles.length; i++) {
    const actualMove = Math.abs(candles[i].close - candles[i - 1].close);
    const expectedMove = atr[i] || atr[i - 1] || 0;
    
    if (expectedMove > 0) {
      sumDeviation += Math.min(2, actualMove / expectedMove);
    }
  }
  
  const avgDeviation = sumDeviation / (candles.length - 1);
  // Lower deviation = less noisy = higher score
  return Math.max(0, Math.min(1, 1.5 - avgDeviation * 0.5));
}

/**
 * Check if pattern direction aligns with market regime
 */
export function isDirectionAlignedWithRegime(
  direction: "BULLISH" | "BEARISH" | "NEUTRAL",
  regime: MarketRegime
): boolean {
  if (direction === "NEUTRAL") return true;
  if (direction === "BULLISH" && regime === "TREND_UP") return true;
  if (direction === "BEARISH" && regime === "TREND_DOWN") return true;
  return false;
}

/**
 * Abstract base class for detectors (optional, for TypeScript users)
 */
export abstract class BaseDetector implements Detector {
  abstract id: string;
  abstract name: string;
  abstract types: PatternType[];
  abstract version: string;
  
  abstract detect(ctx: TAContext): CandidatePattern[];
  
  /**
   * Filter patterns by minimum score
   */
  protected filterByScore(patterns: CandidatePattern[], minScore: number = 0.4): CandidatePattern[] {
    return patterns.filter(p => p.metrics.totalScore >= minScore);
  }
  
  /**
   * Sort patterns by score (descending)
   */
  protected sortByScore(patterns: CandidatePattern[]): CandidatePattern[] {
    return [...patterns].sort((a, b) => b.metrics.totalScore - a.metrics.totalScore);
  }
}
