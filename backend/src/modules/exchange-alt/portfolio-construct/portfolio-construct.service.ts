/**
 * BLOCK 26 — Portfolio Construction Layer Service
 * ================================================
 * 
 * Builds optimal portfolios from ranked opportunities.
 */

import type { Venue } from '../types.js';
import type { AltOppScore } from '../alt-opps/alt-opps.types.js';
import type { PortfolioSlate } from '../portfolio-filter/portfolio-filter.types.js';
import type { MarketContext } from '../ml/ml.types.js';
import type {
  PortfolioPosition,
  ConstructedPortfolio,
  PortfolioConstraints,
  WeightingConfig,
  PCLResponse,
} from './portfolio-construct.types.js';
import {
  DEFAULT_CONSTRAINTS,
  DEFAULT_WEIGHTING,
  calculateKellyWeight,
  calculateConcentrationRisk,
  calculateExpectedReturn,
} from './portfolio-construct.types.js';
import { getSector } from '../portfolio-filter/portfolio-filter.types.js';
import { patternMemoryService } from '../pattern-memory/pattern-memory.service.js';
import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO CONSTRUCTION LAYER SERVICE
// ═══════════════════════════════════════════════════════════════

export class PortfolioConstructionService {
  private constraints: PortfolioConstraints = { ...DEFAULT_CONSTRAINTS };
  private weighting: WeightingConfig = { ...DEFAULT_WEIGHTING };

  /**
   * Construct portfolio from filtered slate
   */
  construct(
    slate: PortfolioSlate,
    marketContext: MarketContext,
    totalCapital: number = 10000,
    venue: Venue = 'MOCK'
  ): PCLResponse {
    const picks = slate.picks;
    const rejections: PCLResponse['rejectionReasons'] = [];
    
    // Additional filtering based on constraints
    const validPicks = this.filterByConstraints(picks, rejections);
    
    // Calculate weights
    const weights = this.calculateWeights(validPicks, marketContext);
    
    // Build positions
    const positions = this.buildPositions(validPicks, weights, totalCapital);
    
    // Rebalance if needed
    const rebalanced = this.rebalance(positions, marketContext);
    
    // Build portfolio object
    const portfolio = this.buildPortfolio(rebalanced, venue, marketContext);
    
    // Generate action items and warnings
    const actionItems = this.generateActionItems(portfolio);
    const warnings = this.generateWarnings(portfolio, marketContext);
    
    return {
      ok: true,
      asOf: Date.now(),
      portfolio,
      candidatesConsidered: picks.length,
      candidatesRejected: rejections.length,
      rejectionReasons: rejections,
      actionItems,
      warnings,
    };
  }

  /**
   * Construct from raw opportunities
   */
  constructFromOpportunities(
    opportunities: AltOppScore[],
    marketContext: MarketContext,
    totalCapital: number = 10000,
    venue: Venue = 'MOCK'
  ): PCLResponse {
    // Convert to simple slate format
    const picks = opportunities.slice(0, this.constraints.maxPositions * 2).map(opp => ({
      symbol: opp.symbol,
      venue: opp.venue,
      score: opp.totalScore,
      adjustedScore: opp.totalScore,
      rank: opp.rank,
      direction: opp.direction,
      expectedMove: `${opp.expectedMove.min.toFixed(0)}-${opp.expectedMove.max.toFixed(0)}%`,
      confidence: opp.confidence,
      patternId: opp.patternId,
      sector: getSector(opp.symbol),
      correlationPenalty: 0,
      reasons: opp.reasons,
      excluded: false,
    }));

    const slate: PortfolioSlate = {
      asOf: Date.now(),
      venue,
      picks,
      excluded: [],
      totalCandidates: opportunities.length,
      finalCount: picks.length,
      uniquePatterns: new Set(picks.map(p => p.patternId)).size,
      uniqueSectors: new Set(picks.map(p => p.sector)).size,
      avgCorrelation: 0.5,
      directionBalance: {
        longs: picks.filter(p => p.direction === 'UP').length,
        shorts: picks.filter(p => p.direction === 'DOWN').length,
      },
      avgScore: picks.reduce((s, p) => s + p.score, 0) / picks.length,
      avgConfidence: picks.reduce((s, p) => s + p.confidence, 0) / picks.length,
    };

    return this.construct(slate, marketContext, totalCapital, venue);
  }

  // ═══════════════════════════════════════════════════════════════
  // CORE METHODS
  // ═══════════════════════════════════════════════════════════════

  private filterByConstraints(
    picks: PortfolioSlate['picks'],
    rejections: PCLResponse['rejectionReasons']
  ): PortfolioSlate['picks'] {
    const sectorCounts = new Map<string, number>();
    const patternCounts = new Map<string, number>();
    const valid: PortfolioSlate['picks'] = [];

    for (const pick of picks) {
      // Check position limit
      if (valid.length >= this.constraints.maxPositions) {
        rejections.push({ symbol: pick.symbol, reason: 'Max positions reached' });
        continue;
      }

      // Check sector concentration
      const sectorCount = sectorCounts.get(pick.sector) ?? 0;
      if (sectorCount >= this.constraints.maxPositions * this.constraints.maxSectorConcentration) {
        rejections.push({ symbol: pick.symbol, reason: `Sector ${pick.sector} at limit` });
        continue;
      }

      // Check pattern concentration
      const patternCount = patternCounts.get(pick.patternId) ?? 0;
      if (patternCount >= this.constraints.maxPositions * this.constraints.maxPatternConcentration) {
        rejections.push({ symbol: pick.symbol, reason: 'Pattern concentration limit' });
        continue;
      }

      valid.push(pick);
      sectorCounts.set(pick.sector, sectorCount + 1);
      patternCounts.set(pick.patternId, patternCount + 1);
    }

    return valid;
  }

  private calculateWeights(
    picks: PortfolioSlate['picks'],
    context: MarketContext
  ): Map<string, number> {
    const weights = new Map<string, number>();
    
    if (picks.length === 0) return weights;

    switch (this.weighting.scheme) {
      case 'EQUAL':
        return this.equalWeights(picks);
      
      case 'SCORE':
        return this.scoreWeights(picks);
      
      case 'CONFIDENCE':
        return this.confidenceWeights(picks);
      
      case 'KELLY':
        return this.kellyWeights(picks);
      
      case 'RISK_PARITY':
        return this.riskParityWeights(picks, context);
      
      default:
        return this.scoreWeights(picks);
    }
  }

  private equalWeights(picks: PortfolioSlate['picks']): Map<string, number> {
    const weight = 1 / picks.length;
    return new Map(picks.map(p => [p.symbol, weight]));
  }

  private scoreWeights(picks: PortfolioSlate['picks']): Map<string, number> {
    const totalScore = picks.reduce((sum, p) => sum + p.score, 0);
    const weights = new Map<string, number>();
    
    for (const pick of picks) {
      let weight = pick.score / totalScore;
      weight = Math.max(this.weighting.minWeight, Math.min(this.weighting.maxWeight, weight));
      weights.set(pick.symbol, weight);
    }
    
    // Normalize
    return this.normalizeWeights(weights);
  }

  private confidenceWeights(picks: PortfolioSlate['picks']): Map<string, number> {
    const totalConf = picks.reduce((sum, p) => sum + p.confidence, 0);
    const weights = new Map<string, number>();
    
    for (const pick of picks) {
      let weight = pick.confidence / totalConf;
      weight = Math.max(this.weighting.minWeight, Math.min(this.weighting.maxWeight, weight));
      weights.set(pick.symbol, weight);
    }
    
    return this.normalizeWeights(weights);
  }

  private kellyWeights(picks: PortfolioSlate['picks']): Map<string, number> {
    const weights = new Map<string, number>();
    
    for (const pick of picks) {
      const record = patternMemoryService.getRecord(pick.patternId);
      if (record && record.totalTrades >= 10) {
        const avgWin = record.avgReturn > 0 ? record.avgReturn : 5;
        const avgLoss = record.avgReturn < 0 ? Math.abs(record.avgReturn) : 3;
        const weight = calculateKellyWeight(
          record.hitRate,
          avgWin,
          avgLoss,
          this.weighting.kellyFraction
        );
        weights.set(pick.symbol, weight);
      } else {
        // Default for insufficient data
        weights.set(pick.symbol, this.weighting.minWeight);
      }
    }
    
    return this.normalizeWeights(weights);
  }

  private riskParityWeights(
    picks: PortfolioSlate['picks'],
    context: MarketContext
  ): Map<string, number> {
    // Simplified risk parity: inverse of estimated volatility
    const weights = new Map<string, number>();
    
    for (const pick of picks) {
      // Use base volatility adjusted by confidence
      const baseVol = context.btcVolatility * (2 - pick.confidence);
      const invVol = 1 / Math.max(0.1, baseVol);
      weights.set(pick.symbol, invVol);
    }
    
    return this.normalizeWeights(weights);
  }

  private normalizeWeights(weights: Map<string, number>): Map<string, number> {
    const total = Array.from(weights.values()).reduce((a, b) => a + b, 0);
    if (total === 0) return weights;
    
    const normalized = new Map<string, number>();
    for (const [symbol, weight] of weights) {
      normalized.set(symbol, weight / total);
    }
    return normalized;
  }

  private buildPositions(
    picks: PortfolioSlate['picks'],
    weights: Map<string, number>,
    totalCapital: number
  ): PortfolioPosition[] {
    return picks.map(pick => {
      const weight = weights.get(pick.symbol) ?? (1 / picks.length);
      
      return {
        symbol: pick.symbol,
        venue: pick.venue,
        weight,
        notional: totalCapital * weight,
        direction: pick.direction,
        confidence: pick.confidence,
        maxLoss: 5, // Default 5% stop
        targetReturn: parseFloat(pick.expectedMove.split('-')[1]) || 5,
        horizon: '4h',
        patternId: pick.patternId,
        sector: pick.sector,
        entryReason: pick.reasons[0] || 'Pattern match',
      };
    });
  }

  private rebalance(
    positions: PortfolioPosition[],
    context: MarketContext
  ): PortfolioPosition[] {
    // Check exposure constraints
    let longExposure = 0;
    let shortExposure = 0;
    
    for (const pos of positions) {
      if (pos.direction === 'UP') longExposure += pos.weight;
      else if (pos.direction === 'DOWN') shortExposure += pos.weight;
    }
    
    // Adjust if exceeding constraints
    if (longExposure > this.constraints.maxLongExposure) {
      const scale = this.constraints.maxLongExposure / longExposure;
      for (const pos of positions) {
        if (pos.direction === 'UP') {
          pos.weight *= scale;
          pos.notional *= scale;
        }
      }
    }
    
    if (shortExposure > this.constraints.maxShortExposure) {
      const scale = this.constraints.maxShortExposure / shortExposure;
      for (const pos of positions) {
        if (pos.direction === 'DOWN') {
          pos.weight *= scale;
          pos.notional *= scale;
        }
      }
    }
    
    return positions;
  }

  private buildPortfolio(
    positions: PortfolioPosition[],
    venue: Venue,
    context: MarketContext
  ): ConstructedPortfolio {
    const longExposure = positions
      .filter(p => p.direction === 'UP')
      .reduce((sum, p) => sum + p.weight, 0);
    
    const shortExposure = positions
      .filter(p => p.direction === 'DOWN')
      .reduce((sum, p) => sum + p.weight, 0);
    
    const totalNotional = positions.reduce((sum, p) => sum + p.notional, 0);
    
    return {
      id: uuidv4(),
      timestamp: Date.now(),
      venue,
      positions,
      totalNotional,
      longExposure,
      shortExposure,
      netExposure: longExposure - shortExposure,
      uniqueSectors: new Set(positions.map(p => p.sector)).size,
      uniquePatterns: new Set(positions.map(p => p.patternId)).size,
      concentrationRisk: calculateConcentrationRisk(positions),
      expectedReturn: calculateExpectedReturn(positions),
      expectedVolatility: context.btcVolatility * 1.5, // Estimate
      sharpeEstimate: 0, // Calculated below
      maxDrawdown: 10, // Conservative estimate
      valueAtRisk: totalNotional * 0.05, // 5% VaR estimate
      marketRegime: context.marketRegime,
      constraints: { ...this.constraints },
    };
  }

  private generateActionItems(portfolio: ConstructedPortfolio): string[] {
    const items: string[] = [];
    
    if (portfolio.positions.length < 3) {
      items.push('Consider waiting for more high-quality opportunities');
    }
    
    if (portfolio.concentrationRisk > 0.6) {
      items.push('Portfolio is concentrated - consider adding diversifying positions');
    }
    
    if (portfolio.netExposure > 0.7) {
      items.push('High net long exposure - consider hedging');
    }
    
    if (portfolio.positions.length > 0) {
      const topPosition = portfolio.positions[0];
      items.push(`Enter ${topPosition.symbol} ${topPosition.direction} (${(topPosition.weight * 100).toFixed(0)}% allocation)`);
    }
    
    return items;
  }

  private generateWarnings(
    portfolio: ConstructedPortfolio,
    context: MarketContext
  ): string[] {
    const warnings: string[] = [];
    
    if (context.marketRegime === 'RISK_OFF') {
      warnings.push('Market in RISK_OFF mode - consider reducing exposure');
    }
    
    if (context.btcVolatility > 0.7) {
      warnings.push('High volatility environment - tighten stops');
    }
    
    if (portfolio.uniqueSectors === 1) {
      warnings.push('All positions in single sector - high correlation risk');
    }
    
    return warnings;
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════

  setConstraints(constraints: Partial<PortfolioConstraints>): void {
    this.constraints = { ...this.constraints, ...constraints };
  }

  getConstraints(): PortfolioConstraints {
    return { ...this.constraints };
  }

  setWeighting(config: Partial<WeightingConfig>): void {
    this.weighting = { ...this.weighting, ...config };
  }

  getWeighting(): WeightingConfig {
    return { ...this.weighting };
  }
}

export const portfolioConstructionService = new PortfolioConstructionService();

console.log('[Block26] Portfolio Construction Service loaded');
