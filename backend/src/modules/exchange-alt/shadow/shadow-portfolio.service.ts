/**
 * BLOCK 17 — Shadow Portfolio Service
 * =====================================
 * 
 * Paper trading in real-time without self-deception.
 */

import type { AltOpportunity, Venue } from '../types.js';
import type {
  ShadowTrade,
  ShadowOutcome,
  ShadowMetrics,
  DecisionGate,
} from './shadow.types.js';
import { labelShadowOutcome, checkDecisionGate, DECISION_GATE_CONFIG } from './shadow.types.js';
import { clusterFeatureBuilder } from '../ml/feature-builder.service.js';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════
// SHADOW PORTFOLIO SERVICE
// ═══════════════════════════════════════════════════════════════

export class ShadowPortfolioService {
  private trades: ShadowTrade[] = [];
  private outcomes: ShadowOutcome[] = [];
  private metrics: ShadowMetrics | null = null;

  /**
   * Create a shadow trade from opportunity
   */
  async createTrade(
    opportunity: AltOpportunity,
    rank: number,
    currentPrice: number,
    venue: Venue = 'MOCK'
  ): Promise<{ trade: ShadowTrade | null; gate: DecisionGate }> {
    const marketContext = clusterFeatureBuilder.buildMarketContext(opportunity.vector);
    
    // Check decision gate
    const gate = checkDecisionGate(
      opportunity.confidence,
      rank,
      marketContext.marketRegime,
      opportunity.vector.volatility_z ?? 0
    );

    if (!gate.passed) {
      // Log AVOID trade
      const avoidTrade: ShadowTrade = {
        id: uuidv4(),
        timestamp: Date.now(),
        date: new Date().toISOString().split('T')[0],
        asset: opportunity.symbol,
        venue,
        side: 'AVOID',
        entryPrice: currentPrice,
        horizon: '4h',
        confidence: opportunity.confidence,
        clusterId: opportunity.clusterId ?? 'NONE',
        patternLabel: opportunity.clusterLabel ?? 'Unknown',
        featuresHash: this.hashFeatures(opportunity),
        marketRegime: marketContext.marketRegime,
        reasons: gate.rejectReasons,
        status: 'OPEN',
        createdAt: Date.now(),
      };
      
      this.trades.push(avoidTrade);
      return { trade: avoidTrade, gate };
    }

    // Create actual trade
    const trade: ShadowTrade = {
      id: uuidv4(),
      timestamp: Date.now(),
      date: new Date().toISOString().split('T')[0],
      asset: opportunity.symbol,
      venue,
      side: opportunity.direction === 'UP' ? 'BUY' : 'SELL',
      entryPrice: currentPrice,
      horizon: '4h',
      confidence: opportunity.confidence,
      clusterId: opportunity.clusterId ?? 'NONE',
      patternLabel: opportunity.clusterLabel ?? 'Unknown',
      featuresHash: this.hashFeatures(opportunity),
      marketRegime: marketContext.marketRegime,
      reasons: opportunity.reasons,
      status: 'OPEN',
      createdAt: Date.now(),
    };

    this.trades.push(trade);
    return { trade, gate };
  }

  /**
   * Close trade with outcome
   */
  closeTrade(tradeId: string, exitPrice: number): ShadowOutcome | null {
    const trade = this.trades.find(t => t.id === tradeId);
    if (!trade || trade.status !== 'OPEN') return null;

    const pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
    const label = labelShadowOutcome(trade.side, pnlPct);

    const outcome: ShadowOutcome = {
      tradeId,
      asset: trade.asset,
      exitPrice,
      pnlPct,
      label,
      horizon: trade.horizon,
      createdAt: Date.now(),
    };

    trade.status = 'CLOSED';
    this.outcomes.push(outcome);

    return outcome;
  }

  /**
   * Get open trades
   */
  getOpenTrades(): ShadowTrade[] {
    return this.trades.filter(t => t.status === 'OPEN');
  }

  /**
   * Calculate metrics
   */
  calculateMetrics(period: '7d' | '30d' | 'all' = '30d'): ShadowMetrics {
    const cutoff = period === 'all' ? 0 : 
      Date.now() - (period === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;

    const relevantOutcomes = this.outcomes.filter(o => o.createdAt >= cutoff);
    const relevantTrades = this.trades.filter(t => t.createdAt >= cutoff);

    const tpCount = relevantOutcomes.filter(o => o.label === 'TP').length;
    const fpCount = relevantOutcomes.filter(o => o.label === 'FP').length;
    const fnCount = relevantOutcomes.filter(o => o.label === 'FN').length;
    const weakCount = relevantOutcomes.filter(o => o.label === 'WEAK').length;
    const avoidCount = relevantTrades.filter(t => t.side === 'AVOID').length;

    const totalDecisions = tpCount + fpCount + weakCount;
    const winRate = totalDecisions > 0 ? tpCount / totalDecisions : 0;
    const precision = (tpCount + fpCount) > 0 ? tpCount / (tpCount + fpCount) : 0;

    // Calculate PnL
    const pnls = relevantOutcomes.map(o => o.pnlPct);
    const avgPnl = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
    const totalPnl = pnls.reduce((a, b) => a + b, 0);

    // Max drawdown
    let maxDrawdown = 0;
    let cumPnl = 0;
    let peak = 0;
    for (const pnl of pnls) {
      cumPnl += pnl;
      peak = Math.max(peak, cumPnl);
      maxDrawdown = Math.max(maxDrawdown, peak - cumPnl);
    }

    // Coverage (unique days with signals)
    const uniqueDays = new Set(relevantTrades.filter(t => t.side !== 'AVOID').map(t => t.date));
    const totalDays = period === '7d' ? 7 : period === '30d' ? 30 : 
      Math.max(1, Math.ceil((Date.now() - Math.min(...relevantTrades.map(t => t.createdAt))) / (24 * 60 * 60 * 1000)));
    const coverage = uniqueDays.size / totalDays;

    // Stability (week-to-week consistency)
    const stability = this.calculateStability(relevantOutcomes);

    // FN rate
    const fnRate = relevantOutcomes.length > 0 ? fnCount / relevantOutcomes.length : 0;

    // Avoid accuracy
    const avoidOutcomes = relevantOutcomes.filter(o => {
      const trade = this.trades.find(t => t.id === o.tradeId);
      return trade?.side === 'AVOID';
    });
    const avoidAccuracy = avoidOutcomes.length > 0 
      ? avoidOutcomes.filter(o => o.label === 'WEAK').length / avoidOutcomes.length 
      : 1;

    this.metrics = {
      period,
      totalTrades: relevantTrades.length,
      tpCount,
      fpCount,
      fnCount,
      weakCount,
      avoidCount,
      winRate,
      precision,
      coverage,
      stability,
      avgPnl,
      totalPnl,
      maxDrawdown,
      hitRateTopK: precision,
      fnRate,
      avoidAccuracy,
      vsBaseline: {
        randomTopVolume: 0,
        rsiOversold: 0,
        yesterdayGainers: 0,
        excessReturn: avgPnl,
      },
      updatedAt: Date.now(),
    };

    return this.metrics;
  }

  /**
   * Get trades history
   */
  getTrades(limit: number = 100): ShadowTrade[] {
    return this.trades.slice(-limit);
  }

  /**
   * Get outcomes history
   */
  getOutcomes(limit: number = 100): ShadowOutcome[] {
    return this.outcomes.slice(-limit);
  }

  /**
   * Get current metrics
   */
  getMetrics(): ShadowMetrics | null {
    return this.metrics;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private hashFeatures(opportunity: AltOpportunity): string {
    const data = JSON.stringify({
      rsi: opportunity.vector.rsi_14,
      funding: opportunity.vector.funding_z,
      trend: opportunity.vector.trend_score,
    });
    return crypto.createHash('md5').update(data).digest('hex').slice(0, 8);
  }

  private calculateStability(outcomes: ShadowOutcome[]): number {
    if (outcomes.length < 14) return 0.5;

    // Split into weeks and compare win rates
    const weeklyRates: number[] = [];
    const week1 = outcomes.slice(0, Math.floor(outcomes.length / 2));
    const week2 = outcomes.slice(Math.floor(outcomes.length / 2));

    const rate1 = week1.filter(o => o.label === 'TP').length / week1.length;
    const rate2 = week2.filter(o => o.label === 'TP').length / week2.length;

    // Stability = 1 - variance
    const variance = Math.pow(rate1 - rate2, 2);
    return Math.max(0, 1 - variance);
  }
}

export const shadowPortfolioService = new ShadowPortfolioService();

console.log('[Block17] Shadow Portfolio Service loaded');
