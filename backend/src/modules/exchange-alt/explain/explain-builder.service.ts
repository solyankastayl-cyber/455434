/**
 * BLOCK 9.6 — Explain Builder Service
 * =====================================
 * 
 * Builds explainable selection reasons for each asset.
 */

import type { IndicatorVector, Venue, PatternCluster } from '../types.js';
import type { MarketContext } from '../ml/ml.types.js';
import type {
  ExplainVector,
  IndicatorDriver,
  PatternEvidence,
  MarketContextBinding,
} from './explain.types.js';
import { DRIVER_CONFIGS, interpretMarketContext } from './explain.types.js';
import { patternConfidenceService } from '../ml/pattern-confidence.service.js';

// ═══════════════════════════════════════════════════════════════
// EXPLAIN BUILDER SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExplainBuilderService {

  /**
   * Build complete explanation for an asset
   */
  buildExplain(
    asset: string,
    date: string,
    vector: IndicatorVector,
    cluster: PatternCluster | null,
    marketContext: MarketContext,
    opportunityScore: number,
    confidence: number,
    venue: Venue = 'MOCK'
  ): ExplainVector {
    // Build drivers
    const drivers = this.buildDrivers(vector);

    // Build pattern evidence
    const patterns = this.buildPatternEvidence(cluster);

    // Build market context binding
    const marketCtx = interpretMarketContext(marketContext);

    // Build summary
    const summary = this.buildSummary(drivers, patterns, marketCtx, opportunityScore);

    return {
      asset,
      date,
      venue,
      opportunityScore,
      confidence,
      drivers,
      patterns,
      marketContext: marketCtx,
      summary,
      createdAt: Date.now(),
    };
  }

  /**
   * Build indicator drivers (top reasons)
   */
  private buildDrivers(vector: IndicatorVector): IndicatorDriver[] {
    const drivers: IndicatorDriver[] = [];

    // Check each indicator against thresholds
    const checks: Array<{ key: keyof typeof DRIVER_CONFIGS; value: number | undefined }> = [
      { key: 'rsi_14', value: vector.rsi_14 },
      { key: 'rsi_z', value: vector.rsi_z },
      { key: 'funding_rate', value: vector.funding_rate },
      { key: 'funding_z', value: vector.funding_z },
      { key: 'oi_change_1h', value: vector.oi_change_1h },
      { key: 'volatility_z', value: vector.volatility_z },
      { key: 'squeeze_score', value: vector.squeeze_score },
      { key: 'trend_score', value: vector.trend_score },
      { key: 'long_bias', value: vector.long_bias },
      { key: 'liq_imbalance', value: vector.liq_imbalance },
      { key: 'breakout_score', value: vector.breakout_score },
      { key: 'meanrev_score', value: vector.meanrev_score },
    ];

    for (const { key, value } of checks) {
      if (value === undefined) continue;

      const config = DRIVER_CONFIGS[key];
      if (!config) continue;

      let direction: IndicatorDriver['direction'] = 'NEUTRAL';
      let strength = 0;
      let reason = '';

      // Check positive condition
      if (config.posThreshold !== undefined && 
          ((config.posThreshold >= 0 && value <= config.posThreshold) ||
           (config.posThreshold < 0 && value <= config.posThreshold))) {
        direction = 'POSITIVE';
        strength = Math.min(1, Math.abs(value - config.posThreshold) / Math.abs(config.posThreshold) * 0.5 + 0.5);
        reason = config.posReason(value);
      }
      // Check negative condition
      else if (config.negThreshold !== undefined && value >= config.negThreshold) {
        direction = 'NEGATIVE';
        strength = Math.min(1, Math.abs(value - config.negThreshold) / Math.abs(config.negThreshold) * 0.5 + 0.5);
        reason = config.negReason(value);
      }

      if (direction !== 'NEUTRAL' && reason) {
        drivers.push({
          indicator: key,
          direction,
          strength,
          value,
          threshold: direction === 'POSITIVE' ? config.posThreshold : config.negThreshold,
          reason,
        });
      }
    }

    // Sort by strength and return top 5
    return drivers
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5);
  }

  /**
   * Build pattern evidence from cluster
   */
  private buildPatternEvidence(cluster: PatternCluster | null): PatternEvidence[] {
    if (!cluster) return [];

    const evidence: PatternEvidence[] = [];

    // Get pattern stats if available
    const stats = patternConfidenceService.getPatternStats(cluster.clusterId);

    evidence.push({
      id: cluster.clusterId,
      name: cluster.label ?? 'Unknown Pattern',
      description: this.describePattern(cluster),
      hitRate7d: stats?.hitRate ?? 0.5,
      avgReturn7d: stats?.avgReturn ?? 0,
      sampleCount: stats?.totalSamples ?? 0,
      confidence: patternConfidenceService.getPatternConfidence(cluster.clusterId),
    });

    return evidence;
  }

  /**
   * Describe pattern based on top features
   */
  private describePattern(cluster: PatternCluster): string {
    const features = cluster.topFeatures.slice(0, 3);
    if (features.length === 0) return 'Mixed technical indicators';

    const descriptions: string[] = [];
    for (const f of features) {
      const val = f.v;
      if (f.k === 'rsi_z' && val < -1) descriptions.push('oversold momentum');
      else if (f.k === 'rsi_z' && val > 1) descriptions.push('overbought momentum');
      else if (f.k === 'funding_z' && val < -1) descriptions.push('negative funding');
      else if (f.k === 'funding_z' && val > 1) descriptions.push('high funding');
      else if (f.k === 'volatility_z' && val < -0.5) descriptions.push('low volatility');
      else if (f.k === 'volatility_z' && val > 1) descriptions.push('high volatility');
      else if (f.k === 'trend_score' && val > 0.5) descriptions.push('uptrend');
      else if (f.k === 'trend_score' && val < -0.5) descriptions.push('downtrend');
      else if (f.k === 'squeeze_score' && val > 0.5) descriptions.push('squeeze setup');
    }

    return descriptions.length > 0 ? descriptions.join(' + ') : 'Technical pattern detected';
  }

  /**
   * Build human-readable summary
   */
  private buildSummary(
    drivers: IndicatorDriver[],
    patterns: PatternEvidence[],
    marketCtx: MarketContextBinding,
    score: number
  ): string {
    const parts: string[] = [];

    // Score context
    if (score >= 70) parts.push('Strong opportunity');
    else if (score >= 50) parts.push('Moderate opportunity');
    else parts.push('Weak signal');

    // Top driver
    if (drivers.length > 0) {
      parts.push(drivers[0].reason);
    }

    // Pattern evidence
    if (patterns.length > 0 && patterns[0].sampleCount >= 20) {
      const p = patterns[0];
      parts.push(`Pattern historically gave ${(p.avgReturn7d * 100).toFixed(1)}% avg return`);
    }

    // Market context
    parts.push(marketCtx.interpretation);

    return parts.join('. ');
  }
}

export const explainBuilderService = new ExplainBuilderService();

console.log('[Block9] Explain Builder Service loaded');
