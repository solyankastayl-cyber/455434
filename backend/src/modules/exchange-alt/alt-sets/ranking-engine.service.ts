/**
 * BLOCK 11.7 — Ranking Engine Service
 * =====================================
 * 
 * Final scoring and ranking of alts.
 */

import type { PatternCluster, AltOpportunity, Venue } from '../types.js';
import type { MarketContext } from '../ml/ml.types.js';
import type {
  AltSetType,
  AltSetEntry,
  AltSetResponse,
  GroupOpportunity,
} from './alt-sets.types.js';
import { calculateGroupScore, calculateExpectedMove } from './alt-sets.types.js';
import { patternConfidenceService } from '../ml/pattern-confidence.service.js';

// ═══════════════════════════════════════════════════════════════
// RANKING ENGINE SERVICE
// ═══════════════════════════════════════════════════════════════

export class RankingEngineService {

  /**
   * Generate alt set by type
   */
  generateAltSet(
    type: AltSetType,
    opportunities: AltOpportunity[],
    clusters: PatternCluster[],
    marketContext: MarketContext,
    venue: Venue = 'MOCK',
    limit: number = 20
  ): AltSetResponse {
    // Filter by type
    const filtered = this.filterByType(opportunities, type);

    // Group by pattern
    const groups = this.groupByPattern(filtered, clusters);

    // Calculate group opportunities
    const groupOpportunities = this.calculateGroupOpportunities(groups);

    // Build entries
    const entries = this.buildEntries(
      filtered,
      groupOpportunities,
      marketContext,
      venue
    );

    // Sort by altScore
    entries.sort((a, b) => b.altScore - a.altScore);

    // Limit
    const limitedEntries = entries.slice(0, limit);

    // Calculate group stats
    const groupStats = this.calculateGroupStats(groupOpportunities);

    // Check regime compatibility
    const regimeCompatible = this.isRegimeCompatible(type, marketContext);

    return {
      type,
      asOf: Date.now(),
      venue,
      entries: limitedEntries,
      groupStats,
      regimeCompatible,
      marketRegime: marketContext.marketRegime,
    };
  }

  /**
   * Filter opportunities by set type
   */
  private filterByType(opportunities: AltOpportunity[], type: AltSetType): AltOpportunity[] {
    switch (type) {
      case 'MOMENTUM':
        return opportunities.filter(o => 
          o.facet === 'MOMENTUM' && o.direction === 'UP');
      
      case 'MEAN_REVERSION':
        return opportunities.filter(o => 
          o.facet === 'MEAN_REVERSION' || 
          (o.vector.oversold_flag === true));
      
      case 'EARLY_REBOUND':
        return opportunities.filter(o => 
          o.facet === 'MEAN_REVERSION' && 
          (o.vector.momentum_1h ?? 0) > 0 &&
          (o.vector.rsi_14 ?? 50) < 40);
      
      case 'SHORT_SQUEEZE':
        return opportunities.filter(o => 
          o.facet === 'FUNDING_FLIP' ||
          ((o.vector.funding_z ?? 0) < -1.5 && (o.vector.long_bias ?? 0) < 0));
      
      case 'BREAKOUT':
        return opportunities.filter(o => 
          o.facet === 'BREAKOUT' || 
          (o.vector.breakout_score ?? 0) > 0.7);
      
      case 'MIXED':
      default:
        return opportunities;
    }
  }

  /**
   * Group opportunities by pattern
   */
  private groupByPattern(
    opportunities: AltOpportunity[],
    clusters: PatternCluster[]
  ): Map<string, { opportunities: AltOpportunity[]; cluster: PatternCluster | undefined }> {
    const groups = new Map<string, { opportunities: AltOpportunity[]; cluster: PatternCluster | undefined }>();

    for (const opp of opportunities) {
      const patternId = opp.clusterId ?? 'NO_CLUSTER';
      
      if (!groups.has(patternId)) {
        const cluster = clusters.find(c => c.clusterId === patternId);
        groups.set(patternId, { opportunities: [], cluster });
      }
      
      groups.get(patternId)!.opportunities.push(opp);
    }

    return groups;
  }

  /**
   * Calculate group opportunities
   */
  private calculateGroupOpportunities(
    groups: Map<string, { opportunities: AltOpportunity[]; cluster: PatternCluster | undefined }>
  ): GroupOpportunity[] {
    const groupOpps: GroupOpportunity[] = [];

    for (const [patternId, { opportunities, cluster }] of groups) {
      // Get pattern stats
      const stats = patternConfidenceService.getPatternStats(patternId);
      const weight = patternConfidenceService.getPatternWeight(patternId);

      // Estimate moved vs remaining (simplified - would need historical data)
      const totalMembers = opportunities.length;
      const movedMembers = Math.floor(totalMembers * 0.3); // Estimate 30% moved
      const remainingMembers = totalMembers - movedMembers;

      // Success rate from stats
      const successRate = stats?.hitRate ?? 0.5;

      // Calculate group score
      const groupScore = calculateGroupScore(
        weight,
        successRate,
        movedMembers / totalMembers
      );

      groupOpps.push({
        patternId,
        patternLabel: cluster?.label ?? 'Unknown',
        totalMembers,
        movedMembers,
        remainingMembers,
        avgReturnMoved: stats?.avgReturn ?? 0.05,
        groupScore,
        candidates: opportunities.map(o => o.symbol),
      });
    }

    return groupOpps.sort((a, b) => b.groupScore - a.groupScore);
  }

  /**
   * Build alt set entries
   */
  private buildEntries(
    opportunities: AltOpportunity[],
    groupOpportunities: GroupOpportunity[],
    marketContext: MarketContext,
    venue: Venue
  ): AltSetEntry[] {
    const entries: AltSetEntry[] = [];
    const groupMap = new Map(groupOpportunities.map(g => [g.patternId, g]));

    for (const opp of opportunities) {
      const group = groupMap.get(opp.clusterId ?? 'NO_CLUSTER');
      
      // Calculate scores
      const groupScore = group?.groupScore ?? 0.5;
      const individualScore = opp.opportunityScore / 100;
      
      // Final altScore = Σ(patternWeight × confidence) × liquidityFactor × regimeCompatibility
      const regimeCompat = this.getRegimeCompatibility(opp.facet, marketContext);
      const altScore = (groupScore * 0.4 + individualScore * 0.6) * 100 * regimeCompat;

      // Expected move
      const { min, max } = calculateExpectedMove(group?.avgReturnMoved ?? 0.05);
      const expectedMove = `${(min * 100).toFixed(0)}-${(max * 100).toFixed(0)}%`;

      // Build entry
      entries.push({
        symbol: opp.symbol,
        venue,
        altScore,
        groupScore: groupScore * 100,
        individualScore: individualScore * 100,
        expectedMove,
        expectedDirection: opp.direction,
        horizon: '4h',
        activePatterns: [opp.clusterId ?? 'NO_CLUSTER'],
        patternLabel: opp.clusterLabel ?? 'Unknown',
        why: this.buildWhy(opp, group),
        groupSize: group?.totalMembers ?? 1,
        groupMovedCount: group?.movedMembers ?? 0,
        groupRemainingRank: group?.candidates.indexOf(opp.symbol) ?? 0,
        confidence: opp.confidence,
        regimeFit: regimeCompat > 0.8,
      });
    }

    return entries;
  }

  /**
   * Build why string
   */
  private buildWhy(opp: AltOpportunity, group: GroupOpportunity | undefined): string {
    const parts: string[] = [];

    if (group && group.movedMembers > 0) {
      parts.push(`Similar group already moved +${(group.avgReturnMoved * 100).toFixed(0)}%`);
    }

    if (opp.reasons.length > 0) {
      parts.push(opp.reasons[0]);
    }

    return parts.join('. ') || 'Pattern match';
  }

  /**
   * Get regime compatibility factor
   */
  private getRegimeCompatibility(facet: string, context: MarketContext): number {
    const regime = context.marketRegime;

    if (regime === 'RISK_OFF') return 0.4;
    if (regime === 'BEAR' && facet === 'MOMENTUM') return 0.6;
    if (regime === 'BULL' && facet === 'MOMENTUM') return 1.1;
    if (regime === 'RANGE' && facet === 'MEAN_REVERSION') return 1.1;
    
    return 0.9;
  }

  /**
   * Check if regime is compatible with set type
   */
  private isRegimeCompatible(type: AltSetType, context: MarketContext): boolean {
    const regime = context.marketRegime;

    if (regime === 'RISK_OFF') return false;
    if (type === 'MOMENTUM' && regime === 'BEAR') return false;
    if (type === 'SHORT_SQUEEZE' && regime === 'BULL') return false;

    return true;
  }

  /**
   * Calculate aggregate group stats
   */
  private calculateGroupStats(groups: GroupOpportunity[]): AltSetResponse['groupStats'] {
    if (groups.length === 0) {
      return {
        totalInPattern: 0,
        alreadyMoved: 0,
        avgMoveOfMoved: 0,
        expectedRemainingMove: 0,
      };
    }

    const totalInPattern = groups.reduce((sum, g) => sum + g.totalMembers, 0);
    const alreadyMoved = groups.reduce((sum, g) => sum + g.movedMembers, 0);
    const avgMoveOfMoved = groups.reduce((sum, g) => sum + g.avgReturnMoved * g.movedMembers, 0) / 
                          Math.max(1, alreadyMoved);
    
    const { min, max } = calculateExpectedMove(avgMoveOfMoved);
    const expectedRemainingMove = (min + max) / 2;

    return {
      totalInPattern,
      alreadyMoved,
      avgMoveOfMoved: avgMoveOfMoved * 100,
      expectedRemainingMove: expectedRemainingMove * 100,
    };
  }
}

export const rankingEngineService = new RankingEngineService();

console.log('[Block11] Ranking Engine Service loaded');
