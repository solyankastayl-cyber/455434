/**
 * BLOCK 20 — Altcoin Opportunity Engine
 * =======================================
 * 
 * Central hub for opportunity detection, scoring, and ranking.
 * Aggregates signals from all subsystems.
 */

import type { AltOpportunity, PatternCluster, Venue, Direction } from '../types.js';
import type { MarketContext } from '../ml/ml.types.js';
import type {
  AltOppScore,
  AOEResponse,
  OppFilter,
  OpportunityComponents,
  AOEWeights,
} from './alt-opps.types.js';
import {
  DEFAULT_OPP_FILTER,
  DEFAULT_AOE_WEIGHTS,
  calculateTotalScore,
  scoreToConfidence,
} from './alt-opps.types.js';
import { patternConfidenceService } from '../ml/pattern-confidence.service.js';
import { adaptiveGatingService } from '../gating/adaptive-gating.service.js';

// ═══════════════════════════════════════════════════════════════
// ALTCOIN OPPORTUNITY ENGINE
// ═══════════════════════════════════════════════════════════════

export class AltOpportunityEngine {
  private weights: AOEWeights = { ...DEFAULT_AOE_WEIGHTS };
  private lastRun: AOEResponse | null = null;

  /**
   * Run the opportunity engine
   */
  run(
    opportunities: AltOpportunity[],
    clusters: PatternCluster[],
    marketContext: MarketContext,
    venue: Venue = 'MOCK',
    filter: OppFilter = DEFAULT_OPP_FILTER
  ): AOEResponse {
    const scores: AltOppScore[] = [];
    const clusterMap = new Map(clusters.map(c => [c.clusterId, c]));

    // Score each opportunity
    for (const opp of opportunities) {
      const cluster = clusterMap.get(opp.clusterId ?? '');
      const score = this.scoreOpportunity(opp, cluster, marketContext);
      
      if (score) {
        scores.push(score);
      }
    }

    // Sort by total score
    scores.sort((a, b) => b.totalScore - a.totalScore);

    // Assign ranks
    scores.forEach((s, i) => s.rank = i + 1);

    // Apply filters
    const filtered = this.applyFilter(scores, filter);

    // Calculate stats
    const avgScore = filtered.length > 0
      ? filtered.reduce((sum, s) => sum + s.totalScore, 0) / filtered.length
      : 0;

    const topPattern = this.findDominantPattern(filtered);
    const dominantDirection = this.findDominantDirection(filtered);

    const response: AOEResponse = {
      ok: true,
      asOf: Date.now(),
      venue,
      opportunities: filtered,
      totalScanned: opportunities.length,
      passedFilter: filtered.length,
      avgScore,
      topPattern,
      dominantDirection,
      dataQuality: this.calculateDataQuality(opportunities),
      staleness: 0,
    };

    this.lastRun = response;
    return response;
  }

  /**
   * Score a single opportunity
   */
  private scoreOpportunity(
    opp: AltOpportunity,
    cluster: PatternCluster | undefined,
    context: MarketContext
  ): AltOppScore | null {
    // Check gating - but be lenient during cold start
    const gateResult = adaptiveGatingService.checkGate(opp, context);
    
    // Only hard-block on explicit HARD gates (RISK_OFF, blocked assets, etc.)
    // During cold start (no ML data), adaptive gates should be lenient
    if (!gateResult.allowed && gateResult.gateType === 'HARD') {
      return null;
    }

    // Get pattern stats
    const patternStats = patternConfidenceService.getPatternStats(opp.clusterId ?? '');
    const patternWeight = patternConfidenceService.getPatternWeight(opp.clusterId ?? '');

    // Calculate component scores
    const components: OpportunityComponents = {
      patternScore: this.calcPatternScore(opp, cluster, patternWeight),
      momentumScore: this.calcMomentumScore(opp),
      contextScore: this.calcContextScore(opp, context),
      timingScore: this.calcTimingScore(opp),
      liquidityScore: this.calcLiquidityScore(opp),
      historyScore: this.calcHistoryScore(patternStats),
    };

    // Calculate total
    let totalScore = calculateTotalScore(components, this.weights);

    // Apply gate multiplier - but ensure minimum visibility during cold start
    const effectiveMultiplier = gateResult.confidenceMultiplier > 0 
      ? gateResult.confidenceMultiplier 
      : 0.5; // Allow soft pass even when gating suggests block
    totalScore *= effectiveMultiplier;

    // Clamp
    totalScore = Math.max(0, Math.min(100, totalScore));

    // Confidence
    const samples = patternStats?.totalSamples ?? 10;
    const confidence = scoreToConfidence(totalScore, samples);

    // Warnings
    const warnings: string[] = [];
    if (gateResult.gateType === 'SOFT') {
      warnings.push('Soft gate: reduced confidence');
    }
    if (components.liquidityScore < 50) {
      warnings.push('Low liquidity');
    }
    if (components.historyScore < 40) {
      warnings.push('Limited historical data');
    }

    return {
      symbol: opp.symbol,
      venue: opp.venue,
      totalScore,
      confidence,
      rank: 0, // Set later
      components,
      direction: opp.direction,
      horizon: '4h',
      expectedMove: {
        min: opp.expectedMove?.minPct ?? 2,
        max: opp.expectedMove?.maxPct ?? 8,
        prob: opp.expectedMove?.probability ?? 0.5,
      },
      patternId: opp.clusterId ?? 'NONE',
      patternLabel: opp.clusterLabel ?? 'Unknown',
      facet: opp.facet,
      reasons: opp.reasons,
      warnings,
      timestamp: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // COMPONENT SCORERS
  // ═══════════════════════════════════════════════════════════════

  private calcPatternScore(
    opp: AltOpportunity,
    cluster: PatternCluster | undefined,
    weight: number
  ): number {
    let score = 50; // Base

    // Similarity to cluster centroid
    score += opp.similarity * 30;

    // Cluster strength
    if (cluster?.performance) {
      score += cluster.performance.strength * 20;
    }

    // Pattern weight adjustment
    score *= weight;

    return Math.min(100, score);
  }

  private calcMomentumScore(opp: AltOpportunity): number {
    const v = opp.vector;
    let score = 50;

    // RSI alignment
    if (opp.direction === 'UP') {
      if (v.rsi_14 < 40) score += 20; // Oversold for long
      if (v.momentum_1h > 0 && v.momentum_4h > 0) score += 15;
    } else if (opp.direction === 'DOWN') {
      if (v.rsi_14 > 60) score += 20; // Overbought for short
      if (v.momentum_1h < 0 && v.momentum_4h < 0) score += 15;
    }

    // Trend score alignment
    const trendAligned = (opp.direction === 'UP' && v.trend_score > 0) ||
                        (opp.direction === 'DOWN' && v.trend_score < 0);
    if (trendAligned) score += 15;

    return Math.min(100, Math.max(0, score));
  }

  private calcContextScore(opp: AltOpportunity, context: MarketContext): number {
    let score = 50;

    // Regime compatibility
    if (context.marketRegime === 'BULL' && opp.direction === 'UP') score += 20;
    if (context.marketRegime === 'BEAR' && opp.direction === 'DOWN') score += 20;
    if (context.marketRegime === 'RANGE') score += 10;
    if (context.marketRegime === 'RISK_OFF') score -= 30;

    // BTC volatility impact
    if (context.btcVolatility < 0.5) score += 10;
    if (context.btcVolatility > 0.8) score -= 15;

    // Funding alignment
    if (opp.direction === 'UP' && context.fundingGlobal < 0) score += 10;
    if (opp.direction === 'DOWN' && context.fundingGlobal > 0) score += 10;

    return Math.min(100, Math.max(0, score));
  }

  private calcTimingScore(opp: AltOpportunity): number {
    let score = 50;

    // Freshness of setup
    score += opp.freshness * 30;

    // Not already moved too much
    const momentum24h = Math.abs(opp.vector.momentum_24h);
    if (momentum24h < 3) score += 15;
    else if (momentum24h > 10) score -= 20;

    // Breakout/meanrev timing
    if (opp.facet === 'BREAKOUT' && opp.vector.breakout_score > 0.7) score += 10;
    if (opp.facet === 'MEAN_REVERSION' && opp.vector.meanrev_score > 0.7) score += 10;

    return Math.min(100, Math.max(0, score));
  }

  private calcLiquidityScore(opp: AltOpportunity): number {
    let score = 70; // Default decent liquidity

    // Volume check
    const volume = opp.vector.meta?.volume ?? 0;
    if (volume > 10_000_000) score = 90;
    else if (volume > 1_000_000) score = 75;
    else if (volume < 100_000) score = 40;

    // OI check for derivatives
    const oi = opp.vector.meta?.oi_raw ?? 0;
    if (oi > 50_000_000) score += 10;
    else if (oi < 1_000_000) score -= 15;

    return Math.min(100, Math.max(0, score));
  }

  private calcHistoryScore(stats: ReturnType<typeof patternConfidenceService.getPatternStats>): number {
    if (!stats) return 40; // No history = low score

    let score = 40;

    // Hit rate
    if (stats.hitRate > 0.6) score += 25;
    else if (stats.hitRate > 0.5) score += 15;
    else if (stats.hitRate < 0.4) score -= 20;

    // Sample size
    if (stats.totalSamples > 50) score += 20;
    else if (stats.totalSamples > 20) score += 10;
    else if (stats.totalSamples < 10) score -= 10;

    // Average return
    if (stats.avgReturn > 0.05) score += 15;
    else if (stats.avgReturn < 0) score -= 15;

    return Math.min(100, Math.max(0, score));
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private applyFilter(scores: AltOppScore[], filter: OppFilter): AltOppScore[] {
    return scores.filter(s => {
      if (filter.minScore && s.totalScore < filter.minScore) return false;
      if (filter.maxRank && s.rank > filter.maxRank) return false;
      if (filter.directions && !filter.directions.includes(s.direction)) return false;
      if (filter.facets && !filter.facets.includes(s.facet)) return false;
      if (filter.excludeSymbols?.includes(s.symbol)) return false;
      if (filter.requireLiquidity && s.components.liquidityScore < 50) return false;
      if (filter.requireHistoryProven && s.components.historyScore < 60) return false;
      return true;
    });
  }

  private findDominantPattern(scores: AltOppScore[]): string {
    const counts = new Map<string, number>();
    for (const s of scores) {
      counts.set(s.patternId, (counts.get(s.patternId) ?? 0) + 1);
    }
    let max = 0;
    let dominant = 'NONE';
    for (const [pattern, count] of counts) {
      if (count > max) {
        max = count;
        dominant = pattern;
      }
    }
    return dominant;
  }

  private findDominantDirection(scores: AltOppScore[]): Direction {
    let ups = 0, downs = 0;
    for (const s of scores) {
      if (s.direction === 'UP') ups++;
      else if (s.direction === 'DOWN') downs++;
    }
    if (ups > downs) return 'UP';
    if (downs > ups) return 'DOWN';
    return 'FLAT';
  }

  private calculateDataQuality(opportunities: AltOpportunity[]): number {
    if (opportunities.length === 0) return 0;
    
    const avgCoverage = opportunities.reduce((sum, o) => 
      sum + (o.vector.quality?.coverage ?? 0.5), 0) / opportunities.length;
    
    return avgCoverage * 100;
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC METHODS
  // ═══════════════════════════════════════════════════════════════

  setWeights(weights: Partial<AOEWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  getWeights(): AOEWeights {
    return { ...this.weights };
  }

  getLastRun(): AOEResponse | null {
    return this.lastRun;
  }
}

export const altOpportunityEngine = new AltOpportunityEngine();

console.log('[Block20] Altcoin Opportunity Engine loaded');
