/**
 * BLOCK 7.4 — Decision Composer Service
 * ======================================
 * 
 * Computes final Alpha Score from Exchange candidates.
 * 
 * FinalAlpha = ExchangeOpportunity × ML_Prob_UP × MarketAlignment × RiskGuard
 */

import type { AltOpportunity, Direction, AltFacet } from '../types.js';
import type {
  ExchangeAlphaCandidate,
  AlphaInsight,
} from './meta-brain.types.js';
import {
  LAYER_WEIGHTS,
  calculateMarketAlignment,
  calculateRiskGuard,
  passesGuards,
} from './meta-brain.types.js';
import { clusterOutcomeModel } from '../ml/cluster-outcome.model.js';
import { clusterFeatureBuilder } from '../ml/feature-builder.service.js';

// ═══════════════════════════════════════════════════════════════
// DECISION COMPOSER SERVICE
// ═══════════════════════════════════════════════════════════════

export class DecisionComposerService {

  /**
   * Convert AltOpportunity to ExchangeAlphaCandidate
   */
  async buildCandidate(
    opportunity: AltOpportunity,
    tf: '1h' | '4h' | '1d' = '1h'
  ): Promise<ExchangeAlphaCandidate> {
    const vector = opportunity.vector;
    
    // Build market context
    const marketContext = clusterFeatureBuilder.buildMarketContext(vector);
    
    // Get ML prediction
    const features = clusterFeatureBuilder.buildClusterFeatures([vector]);
    const prediction = await clusterOutcomeModel.predict(features, marketContext);

    return {
      asset: opportunity.symbol,
      tf,
      opportunityScore: opportunity.opportunityScore,
      mlProbUp: prediction.probUP,
      mlProbDown: prediction.probDOWN,
      patternConfidence: prediction.patternConfidence,
      patternId: opportunity.clusterId ?? 'NO_CLUSTER',
      patternLabel: opportunity.clusterLabel ?? 'Unknown',
      drivers: {
        rsi: vector.rsi_14 ?? 50,
        funding: vector.funding_rate ?? 0,
        oi: vector.oi_change_1h ?? 0,
        volume: vector.momentum_1h ?? 0, // Proxy
        liquidations: vector.liq_imbalance ?? 0,
        trend: vector.trend_score ?? 0,
      },
      marketContext,
      reasons: opportunity.reasons,
    };
  }

  /**
   * Calculate final Alpha Score
   */
  calculateFinalAlpha(candidate: ExchangeAlphaCandidate): number {
    // Check guards first
    const guards = passesGuards(candidate);
    if (!guards.passed) {
      return 0;
    }

    // Market alignment
    const marketAlignment = calculateMarketAlignment(candidate.marketContext.marketRegime);

    // Risk guard
    const riskGuard = calculateRiskGuard(
      candidate.marketContext.fundingGlobal,
      candidate.marketContext.btcVolatility > 0.9
    );

    // Get ML probability based on direction
    const mlProb = candidate.drivers.trend > 0 ? candidate.mlProbUp : candidate.mlProbDown;

    // Final calculation
    // FinalAlpha = ExchangeOpportunity × ML_Prob × MarketAlignment × RiskGuard
    const finalAlpha = 
      candidate.opportunityScore *
      mlProb *
      marketAlignment *
      riskGuard *
      LAYER_WEIGHTS.exchange;

    return Math.min(100, Math.max(0, finalAlpha));
  }

  /**
   * Compose full AlphaInsight from candidate
   */
  async composeInsight(
    candidate: ExchangeAlphaCandidate
  ): Promise<AlphaInsight | null> {
    const guards = passesGuards(candidate);
    
    if (!guards.passed) {
      return null;
    }

    const finalScore = this.calculateFinalAlpha(candidate);
    
    // Determine direction
    const direction: Direction = 
      candidate.mlProbUp > candidate.mlProbDown ? 'UP' :
      candidate.mlProbDown > candidate.mlProbUp ? 'DOWN' : 'FLAT';

    // Determine facet
    const facet = this.inferFacet(candidate);

    // Build why
    const why = this.buildWhy(candidate, direction);

    // Calculate confidence
    const confidence = Math.min(1, 
      candidate.patternConfidence * 0.4 +
      Math.max(candidate.mlProbUp, candidate.mlProbDown) * 0.4 +
      (candidate.marketContext.marketRegime === 'RISK_OFF' ? 0 : 0.2)
    );

    return {
      asset: candidate.asset,
      score: finalScore,
      confidence,
      direction,
      facet,
      why,
      patternId: candidate.patternId,
      expectedMove: this.estimateExpectedMove(candidate, direction),
      source: 'EXCHANGE',
      createdAt: Date.now(),
    };
  }

  /**
   * Process multiple candidates and return ranked insights
   */
  async processAndRank(
    candidates: ExchangeAlphaCandidate[],
    limit: number = 20
  ): Promise<AlphaInsight[]> {
    const insights: AlphaInsight[] = [];

    for (const candidate of candidates) {
      const insight = await this.composeInsight(candidate);
      if (insight && insight.score > 0) {
        insights.push(insight);
      }
    }

    // Sort by score descending
    insights.sort((a, b) => b.score - a.score);

    return insights.slice(0, limit);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════

  private inferFacet(candidate: ExchangeAlphaCandidate): AltFacet {
    const label = candidate.patternLabel.toUpperCase();
    
    if (label.includes('SQUEEZE')) return 'SQUEEZE';
    if (label.includes('BREAKOUT') || label.includes('BREAKDOWN')) return 'BREAKOUT';
    if (label.includes('OVERSOLD') || label.includes('OVERBOUGHT') || label.includes('REVERSION')) {
      return 'MEAN_REVERSION';
    }
    if (label.includes('FUNDING')) return 'FUNDING_FLIP';
    if (label.includes('OI')) return 'OI_SPIKE';
    if (label.includes('LIQUIDATION')) return 'LIQUIDATION_FLUSH';
    
    return 'MOMENTUM';
  }

  private buildWhy(candidate: ExchangeAlphaCandidate, direction: Direction): string[] {
    const why: string[] = [];

    // Pattern reason
    if (candidate.patternLabel !== 'Unknown') {
      why.push(`Pattern: ${candidate.patternLabel}`);
    }

    // Top driver reasons
    if (candidate.reasons.length > 0) {
      why.push(...candidate.reasons.slice(0, 2));
    }

    // Market context
    if (candidate.marketContext.marketRegime === 'RANGE') {
      why.push('BTC in range → alt rotation likely');
    } else if (candidate.marketContext.marketRegime === 'BULL' && direction === 'UP') {
      why.push('BTC bullish → alts may outperform');
    }

    // Funding
    if (candidate.drivers.funding < -0.0001) {
      why.push('Negative funding supports long');
    } else if (candidate.drivers.funding > 0.0003) {
      why.push('High funding — crowded trade risk');
    }

    return why.slice(0, 5);
  }

  private estimateExpectedMove(
    candidate: ExchangeAlphaCandidate,
    direction: Direction
  ): AlphaInsight['expectedMove'] | undefined {
    if (candidate.patternConfidence < 0.3) return undefined;

    // Estimate based on pattern and ML
    const baseMove = direction === 'UP' 
      ? candidate.mlProbUp * 15 // Max 15% for high prob
      : candidate.mlProbDown * 15;

    return {
      horizon: '4h',
      minPct: Math.round(baseMove * 0.5 * 100) / 100,
      maxPct: Math.round(baseMove * 1.5 * 100) / 100,
      probability: Math.max(candidate.mlProbUp, candidate.mlProbDown),
    };
  }
}

export const decisionComposerService = new DecisionComposerService();

console.log('[Block7] Decision Composer Service loaded');
