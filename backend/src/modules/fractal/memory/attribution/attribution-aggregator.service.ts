/**
 * BLOCK 75.UI.1 — Attribution Aggregator Service
 * 
 * Single endpoint → entire Attribution tab.
 * Calculates all metrics from resolved outcomes.
 * 
 * Principles:
 * - No metrics without samples
 * - Confidence intervals where applicable
 * - Grade capping for low sample sizes
 */

import { PredictionOutcomeModel, type PredictionOutcomeDocument } from '../outcome/prediction-outcome.model.js';
import type { 
  AttributionResponse, 
  AttributionMeta, 
  AttributionHeadline,
  TierStats,
  RegimeStats,
  DivergenceStats,
  PhaseStats,
  InsightItem,
  GuardrailsStatus
} from './attribution.types.js';
import type { TierType, GradeType } from '../snapshot/prediction-snapshot.model.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MIN_SAMPLES_TIER = {
  TIMING: 20,
  TACTICAL: 15,
  STRUCTURE: 25
};

const MIN_SAMPLES_OVERALL = 30;
const MIN_SAMPLES_FOR_SHARPE = 30;

const WINDOW_DAYS: Record<string, number> = {
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Wilson score confidence interval for proportions
 */
function wilsonCI(successes: number, total: number, z: number = 1.96): [number, number] | null {
  if (total === 0) return null;
  
  const p = successes / total;
  const n = total;
  const denominator = 1 + z * z / n;
  const centre = p + z * z / (2 * n);
  const adjustment = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  
  return [
    Math.max(0, (centre - adjustment) / denominator),
    Math.min(1, (centre + adjustment) / denominator)
  ];
}

/**
 * Calculate Sharpe ratio approximation
 */
function calculateSharpe(returns: number[]): number | null {
  if (returns.length < MIN_SAMPLES_FOR_SHARPE) return null;
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const std = Math.sqrt(variance);
  
  if (std === 0) return null;
  return mean / std * Math.sqrt(252); // Annualized
}

/**
 * Calculate max drawdown from returns
 */
function calculateMaxDD(returns: number[]): number {
  if (returns.length === 0) return 0;
  
  let peak = 0;
  let maxDD = 0;
  let equity = 100;
  
  for (const r of returns) {
    equity *= (1 + r / 100);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  
  return maxDD * 100;
}

/**
 * Grade from hit rate
 */
function hitRateToGrade(hitRate: number, samples: number, minSamples: number): { grade: GradeType; capped: boolean } {
  let grade: GradeType;
  
  if (hitRate >= 0.65) grade = 'A';
  else if (hitRate >= 0.55) grade = 'B';
  else if (hitRate >= 0.45) grade = 'C';
  else if (hitRate >= 0.35) grade = 'D';
  else grade = 'F';
  
  // Cap grade if low samples
  if (samples < minSamples) {
    const cappedGrade = grade === 'A' || grade === 'B' ? 'C' : grade;
    return { grade: cappedGrade as GradeType, capped: true };
  }
  
  return { grade, capped: false };
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATOR SERVICE
// ═══════════════════════════════════════════════════════════════

export class AttributionAggregatorService {
  
  /**
   * Get date range for window
   * BLOCK 77.4: Added customTo for bootstrap data viewing
   */
  getDateRange(windowDays: number, customTo?: string): { from: string; to: string } {
    const to = customTo ? new Date(customTo) : new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - windowDays);
    
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10)
    };
  }
  
  /**
   * Fetch filtered outcomes
   * BLOCK 77.4: Added source filter for LIVE vs BOOTSTRAP
   */
  async getOutcomes(
    symbol: string,
    windowDays: number,
    preset: string,
    role: string,
    source?: 'LIVE' | 'BOOTSTRAP' | 'ALL',
    customTo?: string
  ): Promise<PredictionOutcomeDocument[]> {
    const { from, to } = this.getDateRange(windowDays, customTo);
    
    const query: any = {
      symbol,
      preset,
      role,
      asofDate: { $gte: from, $lte: to }
    };
    
    // BLOCK 77.4: Filter by source if specified
    if (source && source !== 'ALL') {
      query.source = source;
    }
    
    return PredictionOutcomeModel.find(query).lean() as Promise<PredictionOutcomeDocument[]>;
  }
  
  /**
   * Build headline metrics
   */
  buildHeadline(outcomes: PredictionOutcomeDocument[]): AttributionHeadline {
    const n = outcomes.length;
    
    if (n === 0) {
      return {
        hitRate: 0,
        hitRateCI: null,
        expectancy: 0,
        expectancyCI: null,
        sharpe: null,
        maxDD: 0,
        calibrationError: 0,
        avgDivergenceScore: 0,
        scaledVsRawDelta: 0
      };
    }
    
    const hits = outcomes.filter(o => o.hit).length;
    const returns = outcomes.map(o => o.realizedReturnPct);
    const expected = outcomes.map(o => o.predicted?.p50 || 0);
    
    const hitRate = hits / n;
    const avgRealized = returns.reduce((a, b) => a + b, 0) / n;
    const avgExpected = expected.reduce((a, b) => a + b, 0) / n;
    const avgDivergence = outcomes.reduce((s, o) => s + (o.predicted?.divergenceScore || 0), 0) / n;
    
    return {
      hitRate,
      hitRateCI: wilsonCI(hits, n),
      expectancy: avgRealized,
      expectancyCI: n >= 30 ? [avgRealized - 1.5, avgRealized + 1.5] : null, // Simplified
      sharpe: calculateSharpe(returns),
      maxDD: calculateMaxDD(returns),
      calibrationError: Math.abs(avgExpected - avgRealized),
      avgDivergenceScore: avgDivergence,
      scaledVsRawDelta: 0 // TODO: integrate with scaling engine
    };
  }
  
  /**
   * Build tier breakdown
   */
  buildTierStats(outcomes: PredictionOutcomeDocument[]): TierStats[] {
    const tiers: TierType[] = ['STRUCTURE', 'TACTICAL', 'TIMING'];
    const result: TierStats[] = [];
    
    for (const tier of tiers) {
      // Filter by tier-specific hits from tierTruth
      const tierOutcomes = outcomes.filter(o => 
        o.tierTruth?.some(t => t.tier === tier)
      );
      
      const n = tierOutcomes.length;
      const hits = tierOutcomes.filter(o => 
        o.tierTruth?.find(t => t.tier === tier)?.hit
      ).length;
      
      const returns = tierOutcomes.map(o => o.realizedReturnPct);
      const hitRate = n > 0 ? hits / n : 0;
      const { grade, capped } = hitRateToGrade(hitRate, n, MIN_SAMPLES_TIER[tier]);
      
      const notes: string[] = [];
      if (capped) notes.push('Grade capped due to low sample size');
      if (n < MIN_SAMPLES_TIER[tier]) notes.push(`Need ${MIN_SAMPLES_TIER[tier] - n} more samples`);
      
      result.push({
        tier,
        samples: n,
        hitRate,
        hitRateCI: wilsonCI(hits, n),
        expectancy: n > 0 ? returns.reduce((a, b) => a + b, 0) / n : 0,
        sharpe: calculateSharpe(returns),
        maxDD: calculateMaxDD(returns),
        grade,
        gradeCapped: capped,
        notes
      });
    }
    
    return result;
  }
  
  /**
   * Build regime breakdown
   */
  buildRegimeStats(outcomes: PredictionOutcomeDocument[]): RegimeStats[] {
    const regimeMap: Map<string, PredictionOutcomeDocument[]> = new Map();
    
    for (const o of outcomes) {
      const regime = o.meta?.volRegime || 'UNKNOWN';
      if (!regimeMap.has(regime)) regimeMap.set(regime, []);
      regimeMap.get(regime)!.push(o);
    }
    
    const result: RegimeStats[] = [];
    
    for (const [regime, regimeOutcomes] of regimeMap) {
      const n = regimeOutcomes.length;
      const hits = regimeOutcomes.filter(o => o.hit).length;
      const returns = regimeOutcomes.map(o => o.realizedReturnPct);
      const hitRate = n > 0 ? hits / n : 0;
      const { grade } = hitRateToGrade(hitRate, n, 10);
      
      result.push({
        regime,
        samples: n,
        hitRate,
        expectancy: n > 0 ? returns.reduce((a, b) => a + b, 0) / n : 0,
        maxDD: calculateMaxDD(returns),
        avgVolMult: 1.0, // TODO: from scaling engine
        grade
      });
    }
    
    return result.sort((a, b) => b.samples - a.samples);
  }
  
  /**
   * Build divergence impact
   */
  buildDivergenceStats(outcomes: PredictionOutcomeDocument[]): DivergenceStats[] {
    const grades: GradeType[] = ['A', 'B', 'C', 'D', 'F'];
    const result: DivergenceStats[] = [];
    
    for (const grade of grades) {
      const filtered = outcomes.filter(o => 
        (o.meta?.divergenceGrade || 'C') === grade
      );
      
      if (filtered.length === 0) continue;
      
      const n = filtered.length;
      const hits = filtered.filter(o => o.hit).length;
      const returns = filtered.map(o => o.realizedReturnPct);
      const avgScore = filtered.reduce((s, o) => s + (o.predicted?.divergenceScore || 0), 0) / n;
      
      result.push({
        grade,
        samples: n,
        hitRate: hits / n,
        expectancy: returns.reduce((a, b) => a + b, 0) / n,
        avgScore
      });
    }
    
    return result;
  }
  
  /**
   * Build phase impact
   */
  buildPhaseStats(outcomes: PredictionOutcomeDocument[]): PhaseStats[] {
    const phaseMap: Map<string, PredictionOutcomeDocument[]> = new Map();
    
    for (const o of outcomes) {
      const phase = o.meta?.phaseType || 'UNKNOWN';
      if (!phaseMap.has(phase)) phaseMap.set(phase, []);
      phaseMap.get(phase)!.push(o);
    }
    
    const result: PhaseStats[] = [];
    
    for (const [phaseType, phaseOutcomes] of phaseMap) {
      const n = phaseOutcomes.length;
      const hits = phaseOutcomes.filter(o => o.hit).length;
      const returns = phaseOutcomes.map(o => o.realizedReturnPct);
      const hitRate = n > 0 ? hits / n : 0;
      const { grade } = hitRateToGrade(hitRate, n, 10);
      
      result.push({
        phaseType,
        samples: n,
        score73: 0.5, // TODO: from phase analyzer
        grade,
        sizeMult: 1.0, // TODO: from sizing engine
        hitRate,
        expectancy: n > 0 ? returns.reduce((a, b) => a + b, 0) / n : 0
      });
    }
    
    return result.sort((a, b) => b.samples - a.samples);
  }
  
  /**
   * Generate auto insights (deterministic rules)
   */
  generateInsights(
    headline: AttributionHeadline,
    tiers: TierStats[],
    regimes: RegimeStats[],
    divergence: DivergenceStats[]
  ): InsightItem[] {
    const insights: InsightItem[] = [];
    
    // Tier dominance insight
    const sortedTiers = [...tiers].sort((a, b) => b.hitRate - a.hitRate);
    if (sortedTiers.length >= 2) {
      const best = sortedTiers[0];
      const worst = sortedTiers[sortedTiers.length - 1];
      const delta = (best.hitRate - worst.hitRate) * 100;
      
      if (delta > 10 && best.samples >= 20) {
        insights.push({
          id: 'TIER_DOMINANCE',
          severity: 'INFO',
          message: `${best.tier} outperforms ${worst.tier} by ${delta.toFixed(1)}% hit rate`,
          evidence: `${best.tier}: ${(best.hitRate * 100).toFixed(0)}% (N=${best.samples}) vs ${worst.tier}: ${(worst.hitRate * 100).toFixed(0)}%`
        });
      }
    }
    
    // Crisis regime insight
    const crisisRegime = regimes.find(r => r.regime === 'CRISIS' || r.regime === 'HIGH');
    const normalRegime = regimes.find(r => r.regime === 'NORMAL');
    
    if (crisisRegime && normalRegime && crisisRegime.samples >= 10) {
      if (crisisRegime.expectancy < normalRegime.expectancy - 2) {
        insights.push({
          id: 'CRISIS_UNDERPERFORM',
          severity: 'WARN',
          message: `System underperforms in ${crisisRegime.regime} regime`,
          evidence: `${crisisRegime.regime}: ${crisisRegime.expectancy.toFixed(1)}% vs NORMAL: ${normalRegime.expectancy.toFixed(1)}%`
        });
      }
    }
    
    // Divergence toxicity insight
    const divD = divergence.find(d => d.grade === 'D');
    const divF = divergence.find(d => d.grade === 'F');
    const divA = divergence.find(d => d.grade === 'A');
    
    if (divD && divA && divD.samples >= 5) {
      if (divD.hitRate < divA.hitRate - 0.15) {
        insights.push({
          id: 'DIVERGENCE_TOXIC',
          severity: 'WARN',
          message: `High divergence (D/F grades) correlates with poor outcomes`,
          evidence: `Grade D hit rate: ${(divD.hitRate * 100).toFixed(0)}% vs Grade A: ${(divA.hitRate * 100).toFixed(0)}%`
        });
      }
    }
    
    // Calibration insight
    if (headline.calibrationError > 3) {
      insights.push({
        id: 'CALIBRATION_DRIFT',
        severity: 'WARN',
        message: `Predictions drifting from reality`,
        evidence: `Calibration error: ${headline.calibrationError.toFixed(1)}%`
      });
    }
    
    // Sample size insight
    if (tiers.some(t => t.samples < MIN_SAMPLES_TIER[t.tier])) {
      const lowTiers = tiers.filter(t => t.samples < MIN_SAMPLES_TIER[t.tier]);
      insights.push({
        id: 'LOW_SAMPLES',
        severity: 'INFO',
        message: `Some tiers have insufficient samples for reliable metrics`,
        evidence: lowTiers.map(t => `${t.tier}: ${t.samples}/${MIN_SAMPLES_TIER[t.tier]}`).join(', ')
      });
    }
    
    return insights;
  }
  
  /**
   * Build guardrails status
   */
  buildGuardrails(outcomes: PredictionOutcomeDocument[], tiers: TierStats[]): GuardrailsStatus {
    const capsApplied: string[] = [];
    const reasons: string[] = [];
    
    // Check overall samples
    if (outcomes.length < MIN_SAMPLES_OVERALL) {
      reasons.push(`Need ${MIN_SAMPLES_OVERALL} resolved outcomes, have ${outcomes.length}`);
    }
    
    // Check tier samples
    for (const tier of tiers) {
      if (tier.gradeCapped) {
        capsApplied.push(`${tier.tier} grade capped`);
      }
    }
    
    return {
      minSamplesByTier: MIN_SAMPLES_TIER,
      capsApplied,
      insufficientData: outcomes.length < MIN_SAMPLES_OVERALL,
      reasons
    };
  }
  
  /**
   * Main aggregator entry point
   * BLOCK 77.4: Added source parameter for LIVE/BOOTSTRAP filtering
   */
  async getAttributionData(
    symbol: string = 'BTC',
    window: string = '90d',
    preset: string = 'balanced',
    role: string = 'ACTIVE',
    source?: 'LIVE' | 'BOOTSTRAP' | 'ALL',
    customTo?: string
  ): Promise<AttributionResponse> {
    const windowDays = WINDOW_DAYS[window] || 90;
    const { from, to } = this.getDateRange(windowDays, customTo);
    
    // BLOCK 77.4: Default to ALL if not specified (shows LIVE + BOOTSTRAP)
    const sourceFilter = source || 'ALL';
    
    // Fetch outcomes
    const outcomes = await this.getOutcomes(symbol, windowDays, preset, role, sourceFilter, customTo);
    
    // BLOCK 77.4: Count by source for UI display
    const liveCount = outcomes.filter(o => (o as any).source === 'LIVE' || !(o as any).source).length;
    const bootstrapCount = outcomes.filter(o => (o as any).source === 'BOOTSTRAP').length;
    
    // Build all sections
    const headline = this.buildHeadline(outcomes);
    const tiers = this.buildTierStats(outcomes);
    const regimes = this.buildRegimeStats(outcomes);
    const divergence = this.buildDivergenceStats(outcomes);
    const phases = this.buildPhaseStats(outcomes);
    const insights = this.generateInsights(headline, tiers, regimes, divergence);
    const guardrails = this.buildGuardrails(outcomes, tiers);
    
    return {
      meta: {
        symbol,
        windowDays,
        asof: to,
        preset,
        role,
        sampleCount: outcomes.length,
        resolvedCount: outcomes.length,
        // BLOCK 77.4: Source breakdown
        liveCount,
        bootstrapCount,
        sourceFilter,
      } as AttributionMeta & { liveCount: number; bootstrapCount: number; sourceFilter: string },
      headline,
      tiers,
      regimes,
      divergence,
      phases,
      insights,
      guardrails
    };
  }
}

export const attributionAggregatorService = new AttributionAggregatorService();
