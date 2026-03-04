/**
 * BLOCK 75.3 — Attribution Service
 * 
 * Analyzes resolved outcomes to determine:
 * - Which tier (STRUCTURE/TACTICAL/TIMING) was most accurate
 * - Which divergence grades predict errors
 * - Regime-specific accuracy patterns
 * 
 * Output: Evidence pack for policy updates
 */

import { PredictionOutcomeModel, type PredictionOutcomeDocument, type TierTruth } from '../outcome/prediction-outcome.model.js';
import type { FocusHorizon, TierType, SnapshotPreset } from '../snapshot/prediction-snapshot.model.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface TierAccuracy {
  tier: TierType;
  hits: number;
  total: number;
  hitRate: number;
  avgWeightWhenHit: number;
  avgWeightWhenMiss: number;
}

export interface RegimeAccuracy {
  regime: string;
  hits: number;
  total: number;
  hitRate: number;
  avgReturn: number;
  tierBreakdown: TierAccuracy[];
}

export interface DivergenceImpact {
  grade: string;
  hits: number;
  total: number;
  hitRate: number;
  avgReturn: number;
  errorRate: number; // proportion of misses with large errors
}

export interface AttributionSummary {
  symbol: string;
  period: { from: string; to: string };
  totalOutcomes: number;
  
  // Tier accuracy
  tierAccuracy: TierAccuracy[];
  dominantTier: TierType;
  
  // Regime patterns
  regimeAccuracy: RegimeAccuracy[];
  
  // Divergence impact
  divergenceImpact: DivergenceImpact[];
  
  // Consensus accuracy
  consensusHitRate: number;
  consensusAvgReturn: number;
  
  // Key insights (for policy proposals)
  insights: string[];
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class AttributionService {
  
  /**
   * Calculate tier-level accuracy from outcomes
   */
  calculateTierAccuracy(outcomes: PredictionOutcomeDocument[]): TierAccuracy[] {
    const tiers: TierType[] = ['STRUCTURE', 'TACTICAL', 'TIMING'];
    const result: TierAccuracy[] = [];
    
    for (const tier of tiers) {
      let hits = 0;
      let total = 0;
      let sumWeightHit = 0;
      let sumWeightMiss = 0;
      let countHit = 0;
      let countMiss = 0;
      
      for (const o of outcomes) {
        const tierTruth = o.tierTruth?.find(t => t.tier === tier);
        if (!tierTruth) continue;
        
        total++;
        if (tierTruth.hit) {
          hits++;
          sumWeightHit += tierTruth.weight;
          countHit++;
        } else {
          sumWeightMiss += tierTruth.weight;
          countMiss++;
        }
      }
      
      result.push({
        tier,
        hits,
        total,
        hitRate: total > 0 ? hits / total : 0,
        avgWeightWhenHit: countHit > 0 ? sumWeightHit / countHit : 0,
        avgWeightWhenMiss: countMiss > 0 ? sumWeightMiss / countMiss : 0
      });
    }
    
    return result;
  }
  
  /**
   * Calculate regime-specific accuracy
   */
  calculateRegimeAccuracy(outcomes: PredictionOutcomeDocument[]): RegimeAccuracy[] {
    const regimeMap: Map<string, PredictionOutcomeDocument[]> = new Map();
    
    for (const o of outcomes) {
      const regime = o.meta?.volRegime || 'UNKNOWN';
      if (!regimeMap.has(regime)) regimeMap.set(regime, []);
      regimeMap.get(regime)!.push(o);
    }
    
    const result: RegimeAccuracy[] = [];
    
    for (const [regime, regimeOutcomes] of regimeMap) {
      const hits = regimeOutcomes.filter(o => o.hit).length;
      const avgReturn = regimeOutcomes.reduce((s, o) => s + o.realizedReturnPct, 0) / regimeOutcomes.length;
      const tierBreakdown = this.calculateTierAccuracy(regimeOutcomes);
      
      result.push({
        regime,
        hits,
        total: regimeOutcomes.length,
        hitRate: hits / regimeOutcomes.length,
        avgReturn,
        tierBreakdown
      });
    }
    
    return result.sort((a, b) => b.total - a.total);
  }
  
  /**
   * Calculate divergence grade impact
   */
  calculateDivergenceImpact(outcomes: PredictionOutcomeDocument[]): DivergenceImpact[] {
    const grades = ['A', 'B', 'C', 'D', 'F', 'UNKNOWN'];
    const result: DivergenceImpact[] = [];
    
    for (const grade of grades) {
      const filtered = outcomes.filter(o => (o.meta?.divergenceGrade || 'UNKNOWN') === grade);
      if (filtered.length === 0) continue;
      
      const hits = filtered.filter(o => o.hit).length;
      const avgReturn = filtered.reduce((s, o) => s + o.realizedReturnPct, 0) / filtered.length;
      
      // Error rate: proportion of misses with large errors (>5%)
      const misses = filtered.filter(o => !o.hit);
      const largeErrors = misses.filter(o => Math.abs(o.realizedReturnPct) > 5).length;
      const errorRate = misses.length > 0 ? largeErrors / misses.length : 0;
      
      result.push({
        grade,
        hits,
        total: filtered.length,
        hitRate: hits / filtered.length,
        avgReturn,
        errorRate
      });
    }
    
    return result;
  }
  
  /**
   * Generate insights from attribution data
   */
  generateInsights(
    tierAccuracy: TierAccuracy[],
    regimeAccuracy: RegimeAccuracy[],
    divergenceImpact: DivergenceImpact[]
  ): string[] {
    const insights: string[] = [];
    
    // Tier dominance insight
    const sortedTiers = [...tierAccuracy].sort((a, b) => b.hitRate - a.hitRate);
    if (sortedTiers.length > 0) {
      const best = sortedTiers[0];
      const worst = sortedTiers[sortedTiers.length - 1];
      
      if (best.hitRate - worst.hitRate > 0.1) {
        insights.push(
          `${best.tier} outperforms ${worst.tier} by ${((best.hitRate - worst.hitRate) * 100).toFixed(1)}% hit rate`
        );
      }
    }
    
    // Regime-specific insights
    for (const regime of regimeAccuracy) {
      if (regime.total >= 10) {
        const crisisTier = regime.tierBreakdown.find(t => t.tier === 'STRUCTURE');
        const timingTier = regime.tierBreakdown.find(t => t.tier === 'TIMING');
        
        if (regime.regime === 'CRISIS' || regime.regime === 'HIGH') {
          if (crisisTier && crisisTier.hitRate > 0.6) {
            insights.push(`STRUCTURE accurate in ${regime.regime} regime (${(crisisTier.hitRate * 100).toFixed(0)}% hit rate)`);
          }
          if (timingTier && timingTier.hitRate < 0.4) {
            insights.push(`TIMING underperforms in ${regime.regime} regime (${(timingTier.hitRate * 100).toFixed(0)}% hit rate)`);
          }
        }
      }
    }
    
    // Divergence insights
    const highDivergence = divergenceImpact.find(d => d.grade === 'D' || d.grade === 'F');
    if (highDivergence && highDivergence.errorRate > 0.3) {
      insights.push(
        `High divergence (${highDivergence.grade}) predicts errors ${(highDivergence.errorRate * 100).toFixed(0)}% of misses`
      );
    }
    
    return insights;
  }
  
  /**
   * Build full attribution summary (main entry point)
   */
  async buildAttributionSummary(
    symbol: string = 'BTC',
    from?: string,
    to?: string
  ): Promise<AttributionSummary> {
    const query: any = { symbol };
    if (from && to) {
      query.asofDate = { $gte: from, $lte: to };
    }
    
    const outcomes = await PredictionOutcomeModel.find(query).lean() as PredictionOutcomeDocument[];
    
    if (outcomes.length === 0) {
      return {
        symbol,
        period: { from: from || 'all', to: to || 'all' },
        totalOutcomes: 0,
        tierAccuracy: [],
        dominantTier: 'TACTICAL',
        regimeAccuracy: [],
        divergenceImpact: [],
        consensusHitRate: 0,
        consensusAvgReturn: 0,
        insights: ['No outcomes available for attribution']
      };
    }
    
    const tierAccuracy = this.calculateTierAccuracy(outcomes);
    const regimeAccuracy = this.calculateRegimeAccuracy(outcomes);
    const divergenceImpact = this.calculateDivergenceImpact(outcomes);
    
    // Find dominant tier
    const sortedTiers = [...tierAccuracy].sort((a, b) => b.hitRate - a.hitRate);
    const dominantTier = sortedTiers[0]?.tier || 'TACTICAL';
    
    // Consensus stats
    const consensusHits = outcomes.filter(o => o.hit).length;
    const consensusAvgReturn = outcomes.reduce((s, o) => s + o.realizedReturnPct, 0) / outcomes.length;
    
    const insights = this.generateInsights(tierAccuracy, regimeAccuracy, divergenceImpact);
    
    return {
      symbol,
      period: {
        from: from || outcomes[0]?.asofDate || 'unknown',
        to: to || outcomes[outcomes.length - 1]?.asofDate || 'unknown'
      },
      totalOutcomes: outcomes.length,
      tierAccuracy,
      dominantTier,
      regimeAccuracy,
      divergenceImpact,
      consensusHitRate: consensusHits / outcomes.length,
      consensusAvgReturn,
      insights
    };
  }
}

export const attributionService = new AttributionService();
