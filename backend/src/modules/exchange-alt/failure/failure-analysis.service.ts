/**
 * BLOCK 18 — Failure Analysis Service
 * =====================================
 * 
 * Stop treating symptoms, start treating causes.
 */

import type { ShadowTrade, ShadowOutcome } from '../shadow/shadow.types.js';
import type {
  FailedTrade,
  FailureClass,
  FailureInsight,
  FailureHeatmap,
} from './failure.types.js';
import { classifyFailure, getRecommendedAction } from './failure.types.js';

// ═══════════════════════════════════════════════════════════════
// FAILURE ANALYSIS SERVICE
// ═══════════════════════════════════════════════════════════════

export class FailureAnalysisService {
  private failedTrades: FailedTrade[] = [];
  private clusterFPCounts: Map<string, number> = new Map();

  /**
   * Analyze a failed trade
   */
  analyzeFailed(
    trade: ShadowTrade,
    outcome: ShadowOutcome,
    context: {
      previousRegime: string;
      currentRegime: string;
      volatilityZ: number;
      fundingZ: number;
      oiChange: number;
      volumeRatio: number;
    }
  ): FailedTrade {
    // Determine context flags
    const regimeChanged = context.previousRegime !== context.currentRegime;
    const volSpike = context.volatilityZ > 2;
    const fundingExtreme = Math.abs(context.fundingZ) > 2;
    const squeezeOccurred = fundingExtreme && Math.abs(outcome.pnlPct) > 5;
    const oiDrop = context.oiChange < -10;
    const volumeFake = context.volumeRatio < 0.5;

    // Track consecutive FPs per cluster
    if (outcome.label === 'FP') {
      const count = (this.clusterFPCounts.get(trade.clusterId) ?? 0) + 1;
      this.clusterFPCounts.set(trade.clusterId, count);
    } else {
      this.clusterFPCounts.set(trade.clusterId, 0);
    }

    // Classify
    const failureClass = classifyFailure(trade, outcome, {
      regimeChanged,
      volSpike,
      fundingExtreme,
      squeezeOccurred,
      oiDrop,
      volumeFake,
      consecutiveFPsInCluster: this.clusterFPCounts.get(trade.clusterId) ?? 0,
    });

    const { doNotTrain, action } = getRecommendedAction(failureClass);

    // Determine volatility bucket
    let volatilityBucket: FailedTrade['volatilityBucket'];
    if (context.volatilityZ < -0.5) volatilityBucket = 'LOW';
    else if (context.volatilityZ < 1) volatilityBucket = 'NORMAL';
    else if (context.volatilityZ < 2) volatilityBucket = 'HIGH';
    else volatilityBucket = 'EXTREME';

    // Determine funding state
    let fundingState: FailedTrade['fundingState'];
    if (context.fundingZ > 2) fundingState = 'EXTREME_POS';
    else if (context.fundingZ > 0.5) fundingState = 'POSITIVE';
    else if (context.fundingZ < -2) fundingState = 'EXTREME_NEG';
    else if (context.fundingZ < -0.5) fundingState = 'NEGATIVE';
    else fundingState = 'NEUTRAL';

    // Determine OI state
    let oiState: FailedTrade['oiState'];
    if (context.oiChange > 5) oiState = 'RISING';
    else if (context.oiChange < -5) oiState = 'FALLING';
    else oiState = 'FLAT';

    const failed: FailedTrade = {
      tradeId: trade.id,
      asset: trade.asset,
      side: trade.side as 'BUY' | 'SELL',
      horizon: trade.horizon,
      pnlPct: outcome.pnlPct,
      marketRegime: trade.marketRegime,
      volatilityBucket,
      fundingState,
      oiState,
      clusterId: trade.clusterId,
      topFeatures: trade.reasons.slice(0, 3),
      failureClass,
      doNotTrain,
      recommendedAction: action,
      timestamp: Date.now(),
    };

    this.failedTrades.push(failed);

    // Keep manageable
    if (this.failedTrades.length > 1000) {
      this.failedTrades = this.failedTrades.slice(-500);
    }

    return failed;
  }

  /**
   * Get failure insights
   */
  getInsights(): FailureInsight[] {
    const byClass = new Map<FailureClass, FailedTrade[]>();
    
    for (const trade of this.failedTrades) {
      const existing = byClass.get(trade.failureClass) ?? [];
      existing.push(trade);
      byClass.set(trade.failureClass, existing);
    }

    const insights: FailureInsight[] = [];
    
    for (const [failureClass, trades] of byClass) {
      const avgLoss = trades.reduce((sum, t) => sum + t.pnlPct, 0) / trades.length;
      const affectedAssets = [...new Set(trades.map(t => t.asset))];
      const affectedClusters = [...new Set(trades.map(t => t.clusterId))];

      insights.push({
        failureClass,
        frequency: trades.length,
        avgLoss,
        affectedAssets,
        affectedClusters,
        recommendation: this.getRecommendationText(failureClass),
      });
    }

    return insights.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Build failure heatmap
   */
  buildHeatmap(): FailureHeatmap {
    const matrix: FailureHeatmap['matrix'] = {};
    const fundingStates = ['EXTREME_NEG', 'NEGATIVE', 'NEUTRAL', 'POSITIVE', 'EXTREME_POS'];
    const regimes = ['BULL', 'BEAR', 'RANGE', 'RISK_OFF'];

    // Initialize
    for (const funding of fundingStates) {
      matrix[funding] = {};
      for (const regime of regimes) {
        matrix[funding][regime] = { label: 'WEAK', count: 0, avgReturn: 0 };
      }
    }

    // Fill with data
    for (const trade of this.failedTrades) {
      const cell = matrix[trade.fundingState]?.[trade.marketRegime];
      if (cell) {
        cell.count++;
        cell.avgReturn = (cell.avgReturn * (cell.count - 1) + trade.pnlPct) / cell.count;
        
        // Determine label based on count
        if (trade.pnlPct > 2) cell.label = 'TP';
        else if (trade.pnlPct < -2) cell.label = 'FP';
      }
    }

    return {
      matrix,
      rows: fundingStates,
      cols: regimes,
    };
  }

  /**
   * Get failed trades for training filter
   */
  getDoNotTrainTrades(): FailedTrade[] {
    return this.failedTrades.filter(t => t.doNotTrain);
  }

  /**
   * Get failed trades
   */
  getFailedTrades(limit: number = 50): FailedTrade[] {
    return this.failedTrades.slice(-limit);
  }

  /**
   * Get clusters to freeze
   */
  getClustersToFreeze(): string[] {
    return this.failedTrades
      .filter(t => t.recommendedAction === 'FREEZE_PATTERN')
      .map(t => t.clusterId)
      .filter((v, i, a) => a.indexOf(v) === i);
  }

  private getRecommendationText(failureClass: FailureClass): string {
    switch (failureClass) {
      case 'REGIME_MISMATCH':
        return 'Do not train on regime transitions. Wait for stability.';
      case 'VOLATILITY_SHOCK':
        return 'Add time-based block after volatility spikes.';
      case 'FUNDING_TRAP':
        return 'Reduce weight when funding extreme.';
      case 'LIQUIDITY_MIRAGE':
        return 'Add liquidity quality check.';
      case 'CLUSTER_OVERFIT':
        return 'Freeze this cluster pattern.';
      case 'TIMING_ERROR':
        return 'Consider longer horizon.';
      default:
        return 'Investigate further.';
    }
  }
}

export const failureAnalysisService = new FailureAnalysisService();

console.log('[Block18] Failure Analysis Service loaded');
