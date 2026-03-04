/**
 * BLOCK 2.5 — Alt Candidates Service
 * ====================================
 * Generates UP/DOWN/WATCH candidate lists.
 */

import type { Db, Collection } from 'mongodb';
import type { AltCandidate, AltCandidateSnapshot, Horizon, Direction } from '../db/types.js';
import { buildFundingFeatures, fundingGate, type FundingFeatures } from './funding.feature.builder.js';
import { universeBuilder } from '../../../exchange-alt/universe/universe.builder.js';

// Thresholds
const HIGH_CONF_THRESHOLD = 0.70;
const MIN_CONF_THRESHOLD = 0.55;

// Base move expectations per cluster type
const MOVE_BASE: Record<string, number> = {
  MOMENTUM: 8,
  MEAN_REVERSION: 5,
  FUNDING_SQUEEZE: 12,
  BREAKOUT: 10,
  CONSOLIDATION: 3,
};

export class AltCandidatesService {
  private snapshotCol: Collection<AltCandidateSnapshot> | null = null;

  init(db: Db) {
    this.snapshotCol = db.collection<AltCandidateSnapshot>('alt_candidate_snapshots');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.snapshotCol) return;
    try {
      await this.snapshotCol.createIndex({ ts: -1, horizon: 1, venue: 1 });
    } catch (e) {
      console.warn('[AltCandidates] Index error:', e);
    }
  }

  /**
   * Generate candidates for all enabled symbols
   */
  async generateCandidates(params: {
    horizon: Horizon;
    venue?: string;
    limit?: number;
    minConf?: number;
  }): Promise<AltCandidateSnapshot> {
    const { horizon, venue = 'resolved', limit = 50, minConf = MIN_CONF_THRESHOLD } = params;
    const ts = new Date();

    // Get universe symbols
    const symbols = await universeBuilder.getSymbols('BINANCE');
    const universeSize = symbols.length;

    // Build candidates
    const allCandidates: AltCandidate[] = [];

    for (const symbol of symbols.slice(0, 200)) {  // Limit for performance
      try {
        const candidate = await this.buildCandidate(symbol, horizon);
        if (candidate && candidate.confidence >= minConf) {
          allCandidates.push(candidate);
        }
      } catch (e) {
        // Skip symbol on error
      }
    }

    // Sort by confidence
    allCandidates.sort((a, b) => b.confidence - a.confidence);

    // Bucket by direction
    const buckets = {
      UP: [] as AltCandidate[],
      DOWN: [] as AltCandidate[],
      WATCH: [] as AltCandidate[],
    };

    for (const c of allCandidates.slice(0, limit * 3)) {
      if (c.confidence >= HIGH_CONF_THRESHOLD) {
        if (c.direction === 'UP') buckets.UP.push(c);
        else if (c.direction === 'DOWN') buckets.DOWN.push(c);
        else buckets.WATCH.push(c);
      } else {
        buckets.WATCH.push(c);
      }
    }

    // Trim buckets
    buckets.UP = buckets.UP.slice(0, limit);
    buckets.DOWN = buckets.DOWN.slice(0, limit);
    buckets.WATCH = buckets.WATCH.slice(0, limit);

    // Create snapshot
    const snapshot: AltCandidateSnapshot = {
      ts,
      horizon,
      venue,
      universeSize,
      buckets,
      createdAt: new Date(),
    };

    // Save snapshot
    if (this.snapshotCol) {
      const result = await this.snapshotCol.insertOne(snapshot);
      snapshot._id = result.insertedId;
    }

    return snapshot;
  }

  /**
   * Build candidate for single symbol
   */
  private async buildCandidate(symbol: string, _horizon: Horizon): Promise<AltCandidate | null> {
    // Get funding features
    const funding = await buildFundingFeatures(symbol);
    
    // Get cluster context (simplified - would use real clustering in production)
    const clusterType = this.inferClusterType(funding);
    const clusterScore = this.calculateClusterScore(funding);

    // Calculate base confidence
    const mlConfidence = 0.5;  // Placeholder - would use real ML model
    const baseConf = 0.55 * clusterScore + 0.45 * mlConfidence;

    // Apply funding gate
    const fundingMult = fundingGate(clusterType, funding.fundingSqueezeBias);
    
    // Liquidity multiplier (simplified)
    const liqMult = 1.0;

    // Final confidence
    const confidence = clamp01(baseConf * fundingMult * liqMult);

    // Determine direction
    const direction = this.determineDirection(clusterType, funding);

    // Calculate expected move
    const moveBase = MOVE_BASE[clusterType] ?? 5;
    const expectedMovePct = moveBase * (0.6 + 0.8 * clusterScore) * (0.7 + 0.6 * funding.fundingCrowdedness);

    // Build reasons
    const reasons = this.buildReasons(clusterType, clusterScore, funding);

    // Build tags
    const tags = this.buildTags(funding, clusterType);

    return {
      symbol,
      price: 0,  // Would fetch from price provider
      change24h: 0,
      confidence: Math.round(confidence * 1000) / 1000,
      direction,
      expectedMovePct: Math.round(expectedMovePct * 10) / 10,
      reasons,
      drivers: {
        cluster: clusterType,
        clusterScore: Math.round(clusterScore * 100) / 100,
        funding: {
          z: Math.round(funding.fundingZ * 100) / 100,
          crowdedness: Math.round(funding.fundingCrowdedness * 100) / 100,
          bias: funding.fundingSqueezeBias,
          dispersion: funding.fundingDispersion,
        },
        exchange: {
          regime: undefined,
          oiDelta: undefined,
          liqPressure: undefined,
          orderbookImb: undefined,
          rsi: undefined,
        },
      },
      tags,
    };
  }

  /**
   * Infer cluster type from funding features
   */
  private inferClusterType(funding: FundingFeatures): string {
    if (funding.fundingCrowdedness >= 0.7) {
      return 'FUNDING_SQUEEZE';
    }
    if (Math.abs(funding.fundingTrend) > 0.3) {
      return 'MOMENTUM';
    }
    return 'CONSOLIDATION';
  }

  /**
   * Calculate cluster score
   */
  private calculateClusterScore(funding: FundingFeatures): number {
    // Base score from crowdedness (higher crowdedness = stronger signal)
    let score = 0.5 + funding.fundingCrowdedness * 0.3;
    
    // Boost for clear squeeze bias
    if (funding.fundingSqueezeBias !== 'NEUTRAL') {
      score += 0.15;
    }

    return clamp01(score);
  }

  /**
   * Determine direction based on cluster and funding
   */
  private determineDirection(clusterType: string, funding: FundingFeatures): Direction {
    if (clusterType === 'FUNDING_SQUEEZE') {
      return funding.fundingSqueezeBias === 'UP' ? 'UP' : 
             funding.fundingSqueezeBias === 'DOWN' ? 'DOWN' : 'WATCH';
    }

    if (clusterType === 'MOMENTUM') {
      return funding.fundingTrend > 0 ? 'UP' : funding.fundingTrend < 0 ? 'DOWN' : 'WATCH';
    }

    return 'WATCH';
  }

  /**
   * Build human-readable reasons
   */
  private buildReasons(clusterType: string, clusterScore: number, funding: FundingFeatures): string[] {
    const reasons: string[] = [];

    reasons.push(`Cluster: ${clusterType} (${(clusterScore * 100).toFixed(0)}%)`);

    if (funding.fundingCrowdedness >= 0.5) {
      const dir = funding.fundingZ > 0 ? 'long' : 'short';
      reasons.push(`Funding crowded ${dir} (z=${funding.fundingZ.toFixed(2)}) → squeeze ${funding.fundingSqueezeBias} bias`);
    }

    if (funding.fundingDispersion > 0.01) {
      reasons.push(`Venue dispersion high (${funding.fundingDispersion.toFixed(4)})`);
    }

    return reasons.slice(0, 5);
  }

  /**
   * Build tags
   */
  private buildTags(funding: FundingFeatures, clusterType: string): string[] {
    const tags: string[] = [];

    if (funding.fundingCrowdedness >= 0.7) {
      tags.push(funding.fundingZ > 0 ? 'CROWDED_LONG' : 'CROWDED_SHORT');
    }

    if (funding.fundingSqueezeBias !== 'NEUTRAL') {
      tags.push(`SQUEEZE_${funding.fundingSqueezeBias}`);
    }

    if (clusterType !== 'CONSOLIDATION') {
      tags.push(`CLUSTER_${clusterType}`);
    }

    return tags;
  }

  /**
   * Get latest snapshot
   */
  async getLatestSnapshot(horizon: Horizon = '4h'): Promise<AltCandidateSnapshot | null> {
    if (!this.snapshotCol) return null;
    return this.snapshotCol.find({ horizon }).sort({ ts: -1 }).limit(1).next();
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export const altCandidatesService = new AltCandidatesService();

console.log('[Alts] Candidates Service loaded');
