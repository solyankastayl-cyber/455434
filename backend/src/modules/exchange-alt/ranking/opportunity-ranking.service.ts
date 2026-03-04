/**
 * OPPORTUNITY RANKING SERVICE
 * ============================
 * 
 * Scores and ranks trading opportunities based on cluster membership,
 * pattern strength, and individual asset characteristics.
 */

import type {
  IndicatorVector,
  PatternCluster,
  ClusterMembership,
  AltOpportunity,
  AltFacet,
  Direction,
  Horizon,
} from '../types.js';
import { ALT_SCORE_WEIGHTS } from '../constants.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RankingConfig {
  weights: typeof ALT_SCORE_WEIGHTS;
  minOpportunityScore: number;
  maxOpportunities: number;
  includeNoCluster: boolean;
}

export interface RankingInput {
  vectors: Map<string, IndicatorVector>;
  clusters: PatternCluster[];
  memberships: ClusterMembership[];
  clusterPerformance?: Map<string, {
    avgReturn: number;
    winRate: number;
    strength: number;
    samples: number;
  }>;
}

export interface RankingResult {
  opportunities: AltOpportunity[];
  topLongs: AltOpportunity[];
  topShorts: AltOpportunity[];
  topMeanReversion: AltOpportunity[];
  stats: {
    totalVectors: number;
    totalOpportunities: number;
    avgScore: number;
    avgConfidence: number;
    durationMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY RANKING SERVICE
// ═══════════════════════════════════════════════════════════════

export class OpportunityRankingService {
  private config: RankingConfig;

  constructor(config?: Partial<RankingConfig>) {
    this.config = {
      weights: ALT_SCORE_WEIGHTS,
      minOpportunityScore: 30,
      maxOpportunities: 50,
      includeNoCluster: true,
      ...config,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN RANKING METHOD
  // ═══════════════════════════════════════════════════════════════

  rank(input: RankingInput): RankingResult {
    const startTime = Date.now();
    const opportunities: AltOpportunity[] = [];

    const { vectors, clusters, memberships, clusterPerformance } = input;

    // Create lookup maps
    const membershipBySymbol = new Map<string, ClusterMembership>();
    for (const m of memberships) {
      membershipBySymbol.set(m.symbol, m);
    }

    const clusterById = new Map<string, PatternCluster>();
    for (const c of clusters) {
      clusterById.set(c.clusterId, c);
    }

    // Score each vector
    for (const [symbol, vector] of vectors) {
      const membership = membershipBySymbol.get(symbol);
      const cluster = membership ? clusterById.get(membership.clusterId) : undefined;
      
      // Get cluster performance if available
      const performance = cluster && clusterPerformance
        ? clusterPerformance.get(cluster.clusterId)
        : undefined;

      const opportunity = this.scoreOpportunity(
        vector,
        membership,
        cluster,
        performance
      );

      if (opportunity && opportunity.opportunityScore >= this.config.minOpportunityScore) {
        opportunities.push(opportunity);
      }
    }

    // Sort by score
    opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);

    // Limit results
    const limited = opportunities.slice(0, this.config.maxOpportunities);

    // Categorize
    const topLongs = limited
      .filter(o => o.direction === 'UP')
      .slice(0, 10);
    
    const topShorts = limited
      .filter(o => o.direction === 'DOWN')
      .slice(0, 10);
    
    const topMeanReversion = limited
      .filter(o => o.facet === 'MEAN_REVERSION')
      .slice(0, 10);

    // Stats
    const avgScore = limited.length > 0
      ? limited.reduce((sum, o) => sum + o.opportunityScore, 0) / limited.length
      : 0;
    const avgConfidence = limited.length > 0
      ? limited.reduce((sum, o) => sum + o.confidence, 0) / limited.length
      : 0;

    return {
      opportunities: limited,
      topLongs,
      topShorts,
      topMeanReversion,
      stats: {
        totalVectors: vectors.size,
        totalOpportunities: limited.length,
        avgScore,
        avgConfidence,
        durationMs: Date.now() - startTime,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // OPPORTUNITY SCORING
  // ═══════════════════════════════════════════════════════════════

  private scoreOpportunity(
    vector: IndicatorVector,
    membership?: ClusterMembership,
    cluster?: PatternCluster,
    performance?: {
      avgReturn: number;
      winRate: number;
      strength: number;
      samples: number;
    }
  ): AltOpportunity | null {
    // Determine direction and facet
    const { direction, facet } = this.determineDirectionAndFacet(vector, cluster);

    // Calculate score components
    const similarityScore = membership
      ? membership.similarity * 100
      : this.config.includeNoCluster ? 50 : 0;

    const clusterStrengthScore = performance
      ? Math.min(100, performance.strength * 100 + performance.winRate * 50)
      : this.estimateStrengthFromCluster(cluster);

    const momentumPenalty = this.calculateMomentumPenalty(vector, direction);
    const freshnessScore = this.calculateFreshnessScore(vector, cluster);

    // Weighted score
    const rawScore =
      similarityScore * this.config.weights.similarity +
      clusterStrengthScore * this.config.weights.clusterStrength +
      freshnessScore * this.config.weights.freshness -
      momentumPenalty * this.config.weights.momentumPenalty;

    const opportunityScore = Math.max(0, Math.min(100, rawScore));

    // Calculate confidence
    const confidence = this.calculateConfidence(vector, membership, performance);

    // Generate reasons
    const reasons = this.generateReasons(vector, cluster, direction, facet);

    // Expected move (if we have performance data)
    const expectedMove = this.estimateExpectedMove(vector, performance, direction);

    return {
      symbol: vector.symbol,
      ts: vector.ts,
      venue: vector.venue,
      opportunityScore,
      confidence,
      similarity: membership?.similarity ?? 0,
      clusterStrength: clusterStrengthScore / 100,
      momentumPenalty,
      freshness: freshnessScore / 100,
      clusterId: cluster?.clusterId ?? 'NO_CLUSTER',
      clusterLabel: cluster?.label,
      facet,
      direction,
      reasons,
      vector,
      expectedMove,
    };
  }

  private determineDirectionAndFacet(
    vector: IndicatorVector,
    cluster?: PatternCluster
  ): { direction: Direction; facet: AltFacet } {
    // Use cluster label if available
    if (cluster?.label) {
      const label = cluster.label;
      
      if (label.includes('BULLISH') || label.includes('LONG') || label.includes('UPTREND')) {
        return { direction: 'UP', facet: this.inferFacetFromLabel(label) };
      }
      if (label.includes('BEARISH') || label.includes('SHORT') || label.includes('DOWNTREND')) {
        return { direction: 'DOWN', facet: this.inferFacetFromLabel(label) };
      }
      if (label.includes('OVERSOLD')) {
        return { direction: 'UP', facet: 'MEAN_REVERSION' };
      }
      if (label.includes('OVERBOUGHT')) {
        return { direction: 'DOWN', facet: 'MEAN_REVERSION' };
      }
    }

    // Infer from vector
    const trendScore = vector.trend_score ?? 0;
    const fundingZ = vector.funding_z ?? 0;
    const squeezeScore = vector.squeeze_score ?? 0;
    const breakoutScore = vector.breakout_score ?? 0;
    const meanrevScore = vector.meanrev_score ?? 0;

    // Determine facet
    let facet: AltFacet = 'MOMENTUM';
    
    if (meanrevScore > 0.5 && (vector.oversold_flag || vector.overbought_flag)) {
      facet = 'MEAN_REVERSION';
    } else if (squeezeScore > 0.5) {
      facet = 'SQUEEZE';
    } else if (breakoutScore > 0.7) {
      facet = 'BREAKOUT';
    } else if (Math.abs(fundingZ) > 1.5) {
      facet = 'FUNDING_FLIP';
    } else if (Math.abs(vector.oi_z ?? 0) > 1.5) {
      facet = 'OI_SPIKE';
    } else if (vector.liq_z && Math.abs(vector.liq_z) > 2) {
      facet = 'LIQUIDATION_FLUSH';
    }

    // Determine direction
    let direction: Direction = 'FLAT';
    
    if (facet === 'MEAN_REVERSION') {
      direction = vector.oversold_flag ? 'UP' : 'DOWN';
    } else if (trendScore > 0.3) {
      direction = 'UP';
    } else if (trendScore < -0.3) {
      direction = 'DOWN';
    }

    return { direction, facet };
  }

  private inferFacetFromLabel(label: string): AltFacet {
    if (label.includes('SQUEEZE')) return 'SQUEEZE';
    if (label.includes('BREAKOUT') || label.includes('BREAKDOWN')) return 'BREAKOUT';
    if (label.includes('FUNDING')) return 'FUNDING_FLIP';
    if (label.includes('OI')) return 'OI_SPIKE';
    if (label.includes('OVERSOLD') || label.includes('OVERBOUGHT') || label.includes('REVERSAL')) {
      return 'MEAN_REVERSION';
    }
    if (label.includes('LIQUIDATION')) return 'LIQUIDATION_FLUSH';
    return 'MOMENTUM';
  }

  private calculateMomentumPenalty(vector: IndicatorVector, direction: Direction): number {
    // Penalize if asset has already moved significantly in the expected direction
    const momentum24h = vector.momentum_24h ?? 0;
    
    if (direction === 'UP' && momentum24h > 10) {
      return Math.min(50, momentum24h - 10); // Already up 10%+
    }
    if (direction === 'DOWN' && momentum24h < -10) {
      return Math.min(50, Math.abs(momentum24h) - 10); // Already down 10%+
    }
    
    return 0;
  }

  private calculateFreshnessScore(
    vector: IndicatorVector,
    _cluster?: PatternCluster
  ): number {
    // Fresh setups score higher
    let score = 50; // Base score

    // Squeeze just forming
    if (vector.squeeze_flag && (vector.squeeze_score ?? 0) < 0.7) {
      score += 20;
    }

    // Just crossed oversold/overbought
    const rsi14 = (vector.rsi_14 ?? 50);
    if (rsi14 > 25 && rsi14 < 35) score += 15; // Just above oversold
    if (rsi14 > 65 && rsi14 < 75) score += 15; // Just below overbought

    // Recent momentum shift
    const mom1h = vector.momentum_1h ?? 0;
    const mom4h = vector.momentum_4h ?? 0;
    if (Math.sign(mom1h) !== Math.sign(mom4h)) {
      score += 10; // Momentum divergence
    }

    return Math.min(100, score);
  }

  private estimateStrengthFromCluster(cluster?: PatternCluster): number {
    if (!cluster) return 30;

    // Estimate strength from cluster characteristics
    let strength = 40;

    if (cluster.size >= 5) strength += 15;
    if (cluster.dispersion < 0.3) strength += 20; // Tight cluster
    if (cluster.label && !cluster.label.includes('MIXED')) strength += 15;

    return Math.min(100, strength);
  }

  private calculateConfidence(
    vector: IndicatorVector,
    membership?: ClusterMembership,
    performance?: { samples: number; winRate: number }
  ): number {
    let confidence = 0.5;

    // Data quality
    const coverage = vector.quality?.coverage ?? 0;
    confidence += coverage * 0.2;

    // Cluster membership
    if (membership && membership.similarity > 0.7) {
      confidence += 0.1;
    }

    // Historical performance
    if (performance && performance.samples > 10) {
      confidence += 0.1;
      if (performance.winRate > 0.6) confidence += 0.1;
    }

    return Math.min(1, confidence);
  }

  private generateReasons(
    vector: IndicatorVector,
    cluster: PatternCluster | undefined,
    _direction: Direction,
    facet: AltFacet
  ): string[] {
    const reasons: string[] = [];

    // Cluster-based reason
    if (cluster?.label) {
      reasons.push(`Pattern: ${cluster.label} (${cluster.size} assets)`);
    }

    // Technical reasons
    if (vector.oversold_flag) {
      reasons.push(`RSI oversold (${Math.round(vector.rsi_14 ?? 50)})`);
    }
    if (vector.overbought_flag) {
      reasons.push(`RSI overbought (${Math.round(vector.rsi_14 ?? 50)})`);
    }
    if (vector.squeeze_flag) {
      reasons.push('Volatility squeeze forming');
    }
    if (vector.crowded_trade_flag) {
      reasons.push('Crowded positioning detected');
    }

    // Derivatives reasons
    if (Math.abs(vector.funding_z ?? 0) > 1.5) {
      const fundingDir = (vector.funding_z ?? 0) > 0 ? 'high' : 'negative';
      reasons.push(`Extreme ${fundingDir} funding rate`);
    }
    if (Math.abs(vector.oi_z ?? 0) > 1.5) {
      reasons.push('Unusual OI activity');
    }

    // Trend reason
    if (Math.abs(vector.trend_score ?? 0) > 0.5) {
      const trend = (vector.trend_score ?? 0) > 0 ? 'Bullish' : 'Bearish';
      reasons.push(`${trend} trend confirmed`);
    }

    // Facet-specific reason
    if (facet === 'MEAN_REVERSION' && reasons.length < 4) {
      reasons.push('Mean reversion setup active');
    }

    return reasons.slice(0, 5);
  }

  private estimateExpectedMove(
    _vector: IndicatorVector,
    performance?: { avgReturn: number; winRate: number; samples?: number },
    _direction?: Direction
  ): AltOpportunity['expectedMove'] | undefined {
    if (!performance || (performance.samples ?? 0) < 5) return undefined;

    const baseReturn = Math.abs(performance.avgReturn);
    
    return {
      horizon: '4h' as Horizon,
      minPct: Math.round(baseReturn * 0.5 * 100) / 100,
      maxPct: Math.round(baseReturn * 1.5 * 100) / 100,
      probability: performance.winRate,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════

  updateConfig(config: Partial<RankingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): RankingConfig {
    return { ...this.config };
  }
}

// Singleton instance
export const opportunityRankingService = new OpportunityRankingService();

console.log('[ExchangeAlt] Opportunity Ranking Service loaded');
