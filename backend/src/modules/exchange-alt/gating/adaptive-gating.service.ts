/**
 * BLOCK 19 — Adaptive Gating Service
 * ====================================
 * 
 * Smart signal filtering based on failure history.
 * Trade only where we have edge.
 */

import type { AltOpportunity, Venue } from '../types.js';
import type { MarketContext } from '../ml/ml.types.js';
import type { FailureClass } from '../failure/failure.types.js';
import { failureAnalysisService } from '../failure/failure-analysis.service.js';
import { patternConfidenceService } from '../ml/pattern-confidence.service.js';

// ═══════════════════════════════════════════════════════════════
// GATE TYPES
// ═══════════════════════════════════════════════════════════════

export type GateType = 'HARD' | 'SOFT' | 'ADAPTIVE';

export interface GatedSignal {
  allowed: boolean;
  gateType: GateType;
  gateScore: number;
  reasonCodes: string[];
  
  // Modifications if soft gate
  confidenceMultiplier: number;
  labelOverride?: string;
}

export interface GatingContext {
  asset: string;
  marketRegime: string;
  volatilityState: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  fundingState: string;
  clusterId: string;
  failureClassHistory: FailureClass[];
  opportunityScore: number;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// GATE CONFIG
// ═══════════════════════════════════════════════════════════════

export const GATE_CONFIG = {
  // Thresholds
  hardGateScore: 0.4,
  softGateScore: 0.7,
  
  // Weights for adaptive gate
  weights: {
    winRateCluster: 0.4,
    regimeAlignment: 0.3,
    opportunityScore: 0.2,
    confidence: 0.1,
  },
  
  // Horizon-specific strictness
  horizonStrictness: {
    '15m': 1.5,   // Most strict
    '1h': 1.2,
    '4h': 1.0,
    '24h': 0.8,   // Most lenient
  },
  
  // Failure-to-gate mapping
  failureGates: {
    REGIME_MISMATCH: 'HARD',
    VOLATILITY_SHOCK: 'HARD',
    FUNDING_TRAP: 'SOFT',
    LIQUIDITY_MIRAGE: 'HARD',
    CLUSTER_OVERFIT: 'HARD',
    TIMING_ERROR: 'SOFT',
    UNKNOWN: 'ADAPTIVE',
  } as Record<FailureClass, GateType>,
} as const;

// ═══════════════════════════════════════════════════════════════
// ADAPTIVE GATING SERVICE
// ═══════════════════════════════════════════════════════════════

export class AdaptiveGatingService {
  private blockedAssets: Set<string> = new Set();
  private blockedClusters: Set<string> = new Set();
  private timeBasedBlocks: Map<string, number> = new Map(); // asset -> unblock timestamp

  /**
   * Check if signal should pass through gate
   */
  checkGate(
    opportunity: AltOpportunity,
    context: MarketContext,
    horizon: '1h' | '4h' | '24h' = '4h'
  ): GatedSignal {
    const reasonCodes: string[] = [];
    
    // Build gating context
    const gatingContext: GatingContext = {
      asset: opportunity.symbol,
      marketRegime: context.marketRegime,
      volatilityState: this.mapVolatilityState(context.btcVolatility),
      fundingState: this.mapFundingState(context.fundingGlobal),
      clusterId: opportunity.clusterId ?? 'NONE',
      failureClassHistory: this.getFailureHistory(opportunity.clusterId ?? 'NONE'),
      opportunityScore: opportunity.opportunityScore,
      confidence: opportunity.confidence,
    };

    // 1. Check hard gates
    const hardGateResult = this.checkHardGates(gatingContext);
    if (!hardGateResult.passed) {
      return {
        allowed: false,
        gateType: 'HARD',
        gateScore: 0,
        reasonCodes: hardGateResult.reasons,
        confidenceMultiplier: 0,
      };
    }

    // 2. Calculate adaptive gate score
    const gateScore = this.calculateGateScore(gatingContext, horizon);
    
    // Apply horizon strictness
    const strictness = GATE_CONFIG.horizonStrictness[horizon] ?? 1.0;
    const adjustedScore = gateScore / strictness;

    // 3. Determine gate outcome
    if (adjustedScore < GATE_CONFIG.hardGateScore) {
      reasonCodes.push(`Gate score ${(adjustedScore * 100).toFixed(0)}% below hard threshold`);
      return {
        allowed: false,
        gateType: 'ADAPTIVE',
        gateScore: adjustedScore,
        reasonCodes,
        confidenceMultiplier: 0,
      };
    }

    if (adjustedScore < GATE_CONFIG.softGateScore) {
      reasonCodes.push(`Gate score ${(adjustedScore * 100).toFixed(0)}% - soft pass`);
      return {
        allowed: true,
        gateType: 'SOFT',
        gateScore: adjustedScore,
        reasonCodes,
        confidenceMultiplier: 0.6, // Reduce confidence
        labelOverride: 'LOW_CONFIDENCE',
      };
    }

    // Full pass
    return {
      allowed: true,
      gateType: 'ADAPTIVE',
      gateScore: adjustedScore,
      reasonCodes: ['All gates passed'],
      confidenceMultiplier: 1.0,
    };
  }

  /**
   * Check hard gates (absolute blocks)
   */
  private checkHardGates(ctx: GatingContext): { passed: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // Risk-off regime
    if (ctx.marketRegime === 'RISK_OFF') {
      reasons.push('Market in RISK_OFF mode');
    }

    // Extreme volatility
    if (ctx.volatilityState === 'EXTREME') {
      reasons.push('Extreme volatility');
    }

    // Blocked asset
    if (this.blockedAssets.has(ctx.asset)) {
      reasons.push('Asset blocked');
    }

    // Blocked cluster
    if (this.blockedClusters.has(ctx.clusterId)) {
      reasons.push('Cluster blocked');
    }

    // Time-based block
    const unblockTime = this.timeBasedBlocks.get(ctx.asset);
    if (unblockTime && Date.now() < unblockTime) {
      reasons.push('Time-based block active');
    }

    // Check failure history
    const recentFailures = ctx.failureClassHistory.slice(-5);
    for (const failure of recentFailures) {
      if (GATE_CONFIG.failureGates[failure] === 'HARD') {
        reasons.push(`Recent ${failure} failure`);
        break;
      }
    }

    return { passed: reasons.length === 0, reasons };
  }

  /**
   * Calculate adaptive gate score
   */
  private calculateGateScore(ctx: GatingContext, horizon: string): number {
    const w = GATE_CONFIG.weights;

    // Win rate from cluster
    const stats = patternConfidenceService.getPatternStats(ctx.clusterId);
    const winRateCluster = stats?.hitRate ?? 0.5;

    // Regime alignment (1 if compatible, 0.5 if not)
    const regimeAlignment = ctx.marketRegime !== 'RISK_OFF' && ctx.marketRegime !== 'BEAR' 
      ? 1.0 : 0.5;

    // Normalize opportunity score (0-100 → 0-1)
    const oppScoreNorm = ctx.opportunityScore / 100;

    // Gate score calculation
    const gateScore = 
      w.winRateCluster * winRateCluster +
      w.regimeAlignment * regimeAlignment +
      w.opportunityScore * oppScoreNorm +
      w.confidence * ctx.confidence;

    return Math.min(1, Math.max(0, gateScore));
  }

  /**
   * Block an asset temporarily
   */
  blockAsset(asset: string, durationMs: number = 4 * 60 * 60 * 1000): void {
    this.timeBasedBlocks.set(asset, Date.now() + durationMs);
    console.log(`[Gating] Asset ${asset} blocked for ${durationMs / 1000 / 60} minutes`);
  }

  /**
   * Block a cluster permanently (until unblocked)
   */
  blockCluster(clusterId: string): void {
    this.blockedClusters.add(clusterId);
    console.log(`[Gating] Cluster ${clusterId} blocked`);
  }

  /**
   * Unblock cluster
   */
  unblockCluster(clusterId: string): void {
    this.blockedClusters.delete(clusterId);
  }

  /**
   * Update blocks from failure analysis
   */
  updateFromFailures(): void {
    const clustersToFreeze = failureAnalysisService.getClustersToFreeze();
    for (const cluster of clustersToFreeze) {
      this.blockCluster(cluster);
    }
  }

  /**
   * Get current blocks
   */
  getBlocks(): {
    assets: string[];
    clusters: string[];
    timeBlocks: Array<{ asset: string; unblockAt: number }>;
  } {
    return {
      assets: Array.from(this.blockedAssets),
      clusters: Array.from(this.blockedClusters),
      timeBlocks: Array.from(this.timeBasedBlocks.entries()).map(([asset, time]) => ({
        asset,
        unblockAt: time,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private mapVolatilityState(volatility: number): GatingContext['volatilityState'] {
    if (volatility < 0.3) return 'LOW';
    if (volatility < 0.6) return 'NORMAL';
    if (volatility < 0.9) return 'HIGH';
    return 'EXTREME';
  }

  private mapFundingState(funding: number): string {
    const z = funding * 10000; // Rough normalization
    if (z > 2) return 'EXTREME_POS';
    if (z > 0.5) return 'POSITIVE';
    if (z < -2) return 'EXTREME_NEG';
    if (z < -0.5) return 'NEGATIVE';
    return 'NEUTRAL';
  }

  private getFailureHistory(clusterId: string): FailureClass[] {
    const failures = failureAnalysisService.getFailedTrades(20);
    return failures
      .filter(f => f.clusterId === clusterId)
      .map(f => f.failureClass);
  }
}

export const adaptiveGatingService = new AdaptiveGatingService();

console.log('[Block19] Adaptive Gating Service loaded');
