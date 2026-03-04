/**
 * BLOCK 21 — Portfolio-Aware Filter Service
 * ==========================================
 * 
 * Ensures diversified picks, not concentrated bets.
 */

import type { Venue } from '../types.js';
import type { AltOppScore } from '../alt-opps/alt-opps.types.js';
import type {
  DiversificationConstraints,
  PortfolioPick,
  PortfolioSlate,
} from './portfolio-filter.types.js';
import {
  DEFAULT_DIVERSIFICATION,
  getSector,
  estimateCorrelation,
} from './portfolio-filter.types.js';

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO FILTER SERVICE
// ═══════════════════════════════════════════════════════════════

export class PortfolioFilterService {
  private constraints: DiversificationConstraints = { ...DEFAULT_DIVERSIFICATION };

  /**
   * Filter and diversify opportunities into a portfolio slate
   */
  createSlate(
    opportunities: AltOppScore[],
    maxPicks: number = 10,
    venue: Venue = 'MOCK'
  ): PortfolioSlate {
    const picks: PortfolioPick[] = [];
    const excluded: PortfolioPick[] = [];
    
    // Track counts for constraints
    const patternCounts = new Map<string, number>();
    const sectorCounts = new Map<string, number>();
    let longCount = 0;
    let shortCount = 0;
    
    // Convert to picks with sector info
    const candidates = opportunities.map(opp => this.toPick(opp, venue));
    
    // Sort by original score
    candidates.sort((a, b) => b.score - a.score);
    
    // Greedy selection with constraints
    for (const candidate of candidates) {
      if (picks.length >= maxPicks) {
        candidate.excluded = true;
        candidate.excludeReason = 'Max picks reached';
        excluded.push(candidate);
        continue;
      }
      
      // Check pattern constraint
      const patternCount = patternCounts.get(candidate.patternId) ?? 0;
      if (patternCount >= this.constraints.maxPerPattern) {
        candidate.excluded = true;
        candidate.excludeReason = 'Pattern limit reached';
        excluded.push(candidate);
        continue;
      }
      
      // Check sector constraint
      const sectorCount = sectorCounts.get(candidate.sector) ?? 0;
      if (sectorCount >= this.constraints.maxPerSector) {
        candidate.excluded = true;
        candidate.excludeReason = 'Sector limit reached';
        excluded.push(candidate);
        continue;
      }
      
      // Check direction constraint
      if (candidate.direction === 'UP' && longCount >= this.constraints.maxPerDirection) {
        candidate.excluded = true;
        candidate.excludeReason = 'Long limit reached';
        excluded.push(candidate);
        continue;
      }
      if (candidate.direction === 'DOWN' && shortCount >= this.constraints.maxPerDirection) {
        candidate.excluded = true;
        candidate.excludeReason = 'Short limit reached';
        excluded.push(candidate);
        continue;
      }
      
      // Check correlation with existing picks
      const correlationPenalty = this.calculateCorrelationPenalty(candidate, picks);
      if (correlationPenalty > 0.5) {
        candidate.correlationPenalty = correlationPenalty;
        candidate.adjustedScore = candidate.score * (1 - correlationPenalty * 0.3);
      }
      
      // Accept pick
      candidate.excluded = false;
      candidate.rank = picks.length + 1;
      picks.push(candidate);
      
      // Update counts
      patternCounts.set(candidate.patternId, patternCount + 1);
      sectorCounts.set(candidate.sector, sectorCount + 1);
      if (candidate.direction === 'UP') longCount++;
      if (candidate.direction === 'DOWN') shortCount++;
    }
    
    // Calculate stats
    const uniquePatterns = new Set(picks.map(p => p.patternId)).size;
    const uniqueSectors = new Set(picks.map(p => p.sector)).size;
    const avgCorrelation = this.calculateAverageCorrelation(picks);
    const avgScore = picks.length > 0
      ? picks.reduce((sum, p) => sum + p.score, 0) / picks.length
      : 0;
    const avgConfidence = picks.length > 0
      ? picks.reduce((sum, p) => sum + p.confidence, 0) / picks.length
      : 0;
    
    return {
      asOf: Date.now(),
      venue,
      picks,
      excluded,
      totalCandidates: candidates.length,
      finalCount: picks.length,
      uniquePatterns,
      uniqueSectors,
      avgCorrelation,
      directionBalance: { longs: longCount, shorts: shortCount },
      avgScore,
      avgConfidence,
    };
  }

  /**
   * Convert opportunity to portfolio pick
   */
  private toPick(opp: AltOppScore, venue: Venue): PortfolioPick {
    const sector = getSector(opp.symbol);
    
    return {
      symbol: opp.symbol,
      venue,
      score: opp.totalScore,
      adjustedScore: opp.totalScore,
      rank: 0,
      direction: opp.direction,
      expectedMove: `${opp.expectedMove.min.toFixed(0)}-${opp.expectedMove.max.toFixed(0)}%`,
      confidence: opp.confidence,
      patternId: opp.patternId,
      sector,
      correlationPenalty: 0,
      reasons: opp.reasons,
      excluded: false,
    };
  }

  /**
   * Calculate correlation penalty for a candidate
   */
  private calculateCorrelationPenalty(
    candidate: PortfolioPick,
    existingPicks: PortfolioPick[]
  ): number {
    if (existingPicks.length === 0) return 0;
    
    let totalCorr = 0;
    for (const pick of existingPicks) {
      // Same pattern = high correlation
      if (pick.patternId === candidate.patternId) {
        totalCorr += 0.9;
        continue;
      }
      
      // Sector-based correlation
      totalCorr += estimateCorrelation(pick.sector, candidate.sector);
    }
    
    const avgCorr = totalCorr / existingPicks.length;
    
    // Penalty kicks in above threshold
    if (avgCorr > this.constraints.maxCorrelation) {
      return (avgCorr - this.constraints.maxCorrelation) / (1 - this.constraints.maxCorrelation);
    }
    
    return 0;
  }

  /**
   * Calculate average correlation in portfolio
   */
  private calculateAverageCorrelation(picks: PortfolioPick[]): number {
    if (picks.length < 2) return 0;
    
    let totalCorr = 0;
    let pairs = 0;
    
    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        if (picks[i].patternId === picks[j].patternId) {
          totalCorr += 0.9;
        } else {
          totalCorr += estimateCorrelation(picks[i].sector, picks[j].sector);
        }
        pairs++;
      }
    }
    
    return pairs > 0 ? totalCorr / pairs : 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════

  setConstraints(constraints: Partial<DiversificationConstraints>): void {
    this.constraints = { ...this.constraints, ...constraints };
  }

  getConstraints(): DiversificationConstraints {
    return { ...this.constraints };
  }
}

export const portfolioFilterService = new PortfolioFilterService();

console.log('[Block21] Portfolio Filter Service loaded');
