/**
 * Phase R9: Reliability Engine
 * Core scoring logic with reliability adjustments
 */

import { expDecay, ageInDays } from './utils/decay.js';
import { shrinkToPrior, betaMean } from './utils/smoothing.js';
import { deduplicatePatterns, mergeClusterConfidence, clusterPatterns } from './utils/clustering.js';
import { ReliabilityStats, EffectiveScoreParams, DEFAULT_RELIABILITY_CONFIG } from './reliability.types.js';

/**
 * Timeframe weights (higher timeframes = stronger bias)
 */
const TIMEFRAME_WEIGHTS: Record<string, number> = {
  '1W': 1.2,
  '1D': 1.0,
  '4H': 0.85,
  '1H': 0.70,
  '15M': 0.55,
  '5M': 0.45,
};

/**
 * Regime weights
 */
const REGIME_WEIGHTS: Record<string, number> = {
  TREND_UP: 1.0,
  TREND_DOWN: 1.0,
  RANGE: 0.90,
  TRANSITION: 0.75,
};

/**
 * Compute effective score with reliability adjustments
 */
export function computeEffectiveScore(params: EffectiveScoreParams): number {
  const { baseScore, pWin, ageDays, timeframe, regime, rr } = params;
  
  // Timeframe weight
  const tfW = TIMEFRAME_WEIGHTS[timeframe] ?? 0.7;
  
  // Regime weight
  const regW = REGIME_WEIGHTS[regime] ?? 0.85;
  
  // Recency decay
  const decay = expDecay(ageDays, DEFAULT_RELIABILITY_CONFIG.decayHalfLifeDays);
  
  // Risk/Reward gate (low RR patterns get penalized)
  const rrW = Math.max(0.6, Math.min(1.1, rr / 1.5));
  
  return baseScore * pWin * decay * tfW * regW * rrW;
}

/**
 * Get smoothed win probability from stats
 */
export function getSmoothedPWin(stats: ReliabilityStats | null): number {
  if (!stats || stats.n < DEFAULT_RELIABILITY_CONFIG.minSamplesForStats) {
    return DEFAULT_RELIABILITY_CONFIG.prior;
  }
  
  return stats.pWinSmoothed;
}

/**
 * Calculate pWinSmoothed from raw counts
 */
export function calculatePWinSmoothed(wins: number, losses: number, n: number): number {
  const pBeta = betaMean(wins, losses, 2, 2);
  return shrinkToPrior(
    pBeta,
    n,
    DEFAULT_RELIABILITY_CONFIG.smoothingStrength,
    DEFAULT_RELIABILITY_CONFIG.prior
  );
}

/**
 * Score and filter patterns using reliability layer
 */
export function scoreWithReliability(
  patterns: any[],
  statsMap: Map<string, ReliabilityStats>,
  ctx: {
    timeframe: string;
    regime: string;
    currentTs: number;
  }
): any[] {
  // Step 1: Deduplicate patterns
  const deduped = deduplicatePatterns(
    patterns,
    DEFAULT_RELIABILITY_CONFIG.clusterOverlapThreshold,
    DEFAULT_RELIABILITY_CONFIG.clusterPriceTolerance
  );
  
  // Step 2: Score each pattern
  const scored = deduped.map(p => {
    const key = JSON.stringify({
      patternType: p.type,
      timeframe: ctx.timeframe,
      regime: ctx.regime,
    });
    
    const stats = statsMap.get(key);
    const pWin = getSmoothedPWin(stats);
    const ageDays = ageInDays(p.ts || ctx.currentTs, ctx.currentTs);
    
    const effectiveScore = computeEffectiveScore({
      baseScore: p.confidence || 0.5,
      pWin,
      ageDays,
      timeframe: ctx.timeframe,
      regime: ctx.regime,
      rr: stats?.avgRR || 1.5,
    });
    
    return {
      ...p,
      effectiveScore,
      reliabilityMeta: {
        pWin,
        ageDays,
        sampleSize: stats?.n || 0,
        avgRR: stats?.avgRR || 0,
      },
    };
  });
  
  // Step 3: Sort by effective score
  scored.sort((a, b) => b.effectiveScore - a.effectiveScore);
  
  return scored;
}

/**
 * Get top-K patterns after reliability scoring
 */
export function getTopKReliable(
  patterns: any[],
  statsMap: Map<string, ReliabilityStats>,
  ctx: {
    timeframe: string;
    regime: string;
    currentTs: number;
  },
  topK = 10
): any[] {
  const scored = scoreWithReliability(patterns, statsMap, ctx);
  return scored.slice(0, topK);
}

/**
 * Filter patterns by minimum effective score
 */
export function filterByMinScore(patterns: any[], minScore = 0.3): any[] {
  return patterns.filter(p => (p.effectiveScore || p.confidence || 0) >= minScore);
}
