/**
 * BLOCK 77.1 — Learning Aggregator Service
 * 
 * Aggregates forward truth data from Memory Layer (BLOCK 75)
 * into a clean LearningVector for Proposal Engine.
 * 
 * NO policy changes here - only statistical preparation.
 */

import {
  LearningVector,
  LearningAggregatorInput,
  TierPerformance,
  TierName,
  RegimeName,
  DivergenceGrade,
  PhasePerformanceEntry,
  emptyTierPerformance,
  MIN_SAMPLES_FOR_LEARNING,
  MAX_CALIBRATION_ERROR,
  MAX_CRISIS_SHARE,
  MIN_SHARPE_DELTA,
} from './learning.types.js';
import { attributionAggregatorService } from '../memory/attribution/attribution-aggregator.service.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function calculateSharpe(returns: number[], riskFreeRate = 0): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean - riskFreeRate) / std;
}

function calculateMaxDD(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0;
  let maxDD = 0;
  let peak = equityCurve[0];
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function tierFromHorizon(horizon: string): TierName {
  if (['180d', '365d'].includes(horizon)) return 'STRUCTURE';
  if (['30d', '90d'].includes(horizon)) return 'TACTICAL';
  return 'TIMING';
}

// ═══════════════════════════════════════════════════════════════
// LEARNING AGGREGATOR SERVICE
// ═══════════════════════════════════════════════════════════════

export class LearningAggregatorService {
  
  /**
   * Build Learning Vector from forward truth data
   */
  async buildLearningVector(input: LearningAggregatorInput): Promise<LearningVector> {
    const { symbol, windowDays, preset = 'balanced', role = 'ACTIVE' } = input;
    
    // Get attribution data from Memory Layer
    const attribution = await attributionAggregatorService.getAttributionData(
      symbol,
      `${windowDays}d`,
      preset,
      role
    );
    
    // Initialize result
    const asof = new Date().toISOString();
    const resolvedSamples = attribution.meta.sampleCount;
    
    // Build tier performance
    const tier = this.buildTierPerformance(attribution.tiers);
    
    // Build regime performance
    const regime = this.buildRegimePerformance(attribution.regimes);
    
    // Build phase performance
    const phase = this.buildPhasePerformance(attribution.phases || []);
    
    // Build divergence impact
    const divergenceImpact = this.buildDivergenceImpact(attribution.divergence || []);
    
    // Calculate equity drift (forward vs expected)
    const equityDrift = this.calculateEquityDrift(attribution);
    
    // Calculate calibration error
    const calibrationError = this.calculateCalibrationError(attribution);
    
    // Calculate regime distribution
    const regimeDistribution = this.calculateRegimeDistribution(attribution.regimes);
    
    // Determine dominant tier and regime
    const dominantTier = this.findDominantTier(tier);
    const dominantRegime = this.findDominantRegime(regimeDistribution);
    
    // Check learning eligibility
    const { eligible, reasons } = this.checkEligibility(
      resolvedSamples,
      regimeDistribution,
      calibrationError,
      equityDrift
    );
    
    return {
      symbol,
      windowDays,
      asof,
      resolvedSamples,
      sourceCounts: {
        live: attribution.meta.liveCount || 0,
        bootstrap: attribution.meta.bootstrapCount || 0,
        total: resolvedSamples,
      },
      tier,
      regime,
      phase,
      divergenceImpact,
      equityDrift,
      calibrationError,
      learningEligible: eligible,
      eligibilityReasons: reasons,
      regimeDistribution,
      dominantTier,
      dominantRegime,
    };
  }
  
  /**
   * Build tier performance from attribution tiers
   */
  private buildTierPerformance(tiers: any[]): Record<TierName, TierPerformance> {
    const result: Record<TierName, TierPerformance> = {
      STRUCTURE: emptyTierPerformance(),
      TACTICAL: emptyTierPerformance(),
      TIMING: emptyTierPerformance(),
    };
    
    for (const t of tiers) {
      const tierName = t.tier as TierName;
      if (result[tierName]) {
        result[tierName] = {
          hitRate: t.hitRate || 0,
          sharpe: t.sharpe ?? 0,
          expectancy: t.expectancy || 0,
          samples: t.n || 0,
          maxDD: t.maxDD || 0,
          avgReturn: t.avgReturn || t.expectancy || 0,
          winRate: t.hitRate || 0,
        };
      }
    }
    
    return result;
  }
  
  /**
   * Build regime performance from attribution regimes
   */
  private buildRegimePerformance(regimes: any[]): Record<RegimeName, TierPerformance> {
    const result: Record<RegimeName, TierPerformance> = {
      LOW: emptyTierPerformance(),
      NORMAL: emptyTierPerformance(),
      HIGH: emptyTierPerformance(),
      EXPANSION: emptyTierPerformance(),
      CRISIS: emptyTierPerformance(),
    };
    
    for (const r of regimes) {
      const regimeName = r.regime as RegimeName;
      if (result[regimeName]) {
        result[regimeName] = {
          hitRate: r.hit || r.hitRate || 0,
          sharpe: r.sharpe ?? 0,
          expectancy: r.exp || r.expectancy || 0,
          samples: r.n || 0,
          maxDD: r.maxDD || 0,
          avgReturn: r.exp || 0,
          winRate: r.hit || 0,
        };
      }
    }
    
    return result;
  }
  
  /**
   * Build phase performance
   */
  private buildPhasePerformance(phases: any[]): PhasePerformanceEntry[] {
    return phases.map(p => ({
      phase: p.phase || 'UNKNOWN',
      grade: p.grade || 'C',
      hitRate: p.hitRate || 0,
      sharpe: p.sharpe ?? 0,
      expectancy: p.expectancy || 0,
      samples: p.n || p.samples || 0,
      avgStrength: p.avgStrength || 0.5,
    }));
  }
  
  /**
   * Build divergence impact by grade
   */
  private buildDivergenceImpact(divergence: any[]): Record<DivergenceGrade, TierPerformance> {
    const result: Record<DivergenceGrade, TierPerformance> = {
      A: emptyTierPerformance(),
      B: emptyTierPerformance(),
      C: emptyTierPerformance(),
      D: emptyTierPerformance(),
      F: emptyTierPerformance(),
    };
    
    for (const d of divergence) {
      const grade = d.grade as DivergenceGrade;
      if (result[grade]) {
        result[grade] = {
          hitRate: d.hit || d.hitRate || 0,
          sharpe: d.sharpe ?? 0,
          expectancy: d.exp || d.expectancy || 0,
          samples: d.n || 0,
          maxDD: d.maxDD || 0,
          avgReturn: d.exp || 0,
          winRate: d.hit || 0,
        };
      }
    }
    
    return result;
  }
  
  /**
   * Calculate equity drift (forward vs expected)
   */
  private calculateEquityDrift(attribution: any) {
    // Forward performance from attribution
    const forwardSharpe = attribution.meta?.forwardSharpe ?? 0;
    const forwardMaxDD = attribution.meta?.forwardMaxDD ?? 0;
    const forwardHitRate = attribution.meta?.forwardHitRate ?? 0.5;
    const forwardExpectancy = attribution.meta?.forwardExpectancy ?? 0;
    
    // Expected performance (from backtest or baseline)
    const expectedSharpe = attribution.meta?.expectedSharpe ?? 0.5;
    const expectedMaxDD = attribution.meta?.expectedMaxDD ?? 0.15;
    const expectedHitRate = attribution.meta?.expectedHitRate ?? 0.55;
    const expectedExpectancy = attribution.meta?.expectedExpectancy ?? 0.02;
    
    return {
      deltaSharpe: forwardSharpe - expectedSharpe,
      deltaMaxDD: forwardMaxDD - expectedMaxDD,
      deltaHitRate: forwardHitRate - expectedHitRate,
      deltaExpectancy: forwardExpectancy - expectedExpectancy,
    };
  }
  
  /**
   * Calculate calibration error (mean absolute error)
   */
  private calculateCalibrationError(attribution: any): number {
    // Simplified: use divergence as proxy for calibration error
    const avgDivergence = attribution.meta?.avgDivergence ?? 50;
    return (100 - avgDivergence) / 100;
  }
  
  /**
   * Calculate regime distribution
   */
  private calculateRegimeDistribution(regimes: any[]): Record<RegimeName, number> {
    const result: Record<RegimeName, number> = {
      LOW: 0,
      NORMAL: 0,
      HIGH: 0,
      EXPANSION: 0,
      CRISIS: 0,
    };
    
    const total = regimes.reduce((sum, r) => sum + (r.n || 0), 0);
    if (total === 0) return result;
    
    for (const r of regimes) {
      const regimeName = r.regime as RegimeName;
      if (result[regimeName] !== undefined) {
        result[regimeName] = (r.n || 0) / total;
      }
    }
    
    return result;
  }
  
  /**
   * Find dominant tier by Sharpe
   */
  private findDominantTier(tier: Record<TierName, TierPerformance>): TierName {
    let best: TierName = 'TACTICAL';
    let bestSharpe = -Infinity;
    
    for (const [name, perf] of Object.entries(tier)) {
      if (perf.samples >= 5 && perf.sharpe > bestSharpe) {
        bestSharpe = perf.sharpe;
        best = name as TierName;
      }
    }
    
    return best;
  }
  
  /**
   * Find dominant regime by share
   */
  private findDominantRegime(distribution: Record<RegimeName, number>): RegimeName {
    let best: RegimeName = 'NORMAL';
    let bestShare = 0;
    
    for (const [name, share] of Object.entries(distribution)) {
      if (share > bestShare) {
        bestShare = share;
        best = name as RegimeName;
      }
    }
    
    return best;
  }
  
  /**
   * Check learning eligibility
   */
  private checkEligibility(
    samples: number,
    regimeDistribution: Record<RegimeName, number>,
    calibrationError: number,
    equityDrift: { deltaSharpe: number }
  ): { eligible: boolean; reasons: string[] } {
    const reasons: string[] = [];
    
    // Check 1: Minimum samples
    if (samples < MIN_SAMPLES_FOR_LEARNING) {
      reasons.push(`Insufficient samples: ${samples} < ${MIN_SAMPLES_FOR_LEARNING} required`);
    }
    
    // Check 2: CRISIS share
    const crisisShare = regimeDistribution.CRISIS || 0;
    if (crisisShare > MAX_CRISIS_SHARE) {
      reasons.push(`CRISIS regime dominance: ${(crisisShare * 100).toFixed(0)}% > ${MAX_CRISIS_SHARE * 100}% max`);
    }
    
    // Check 3: Calibration error
    if (calibrationError > MAX_CALIBRATION_ERROR) {
      reasons.push(`High calibration error: ${(calibrationError * 100).toFixed(0)}% > ${MAX_CALIBRATION_ERROR * 100}% max`);
    }
    
    // Check 4: Equity drift
    if (equityDrift.deltaSharpe < MIN_SHARPE_DELTA) {
      reasons.push(`Negative equity drift: Sharpe ${equityDrift.deltaSharpe.toFixed(2)} < ${MIN_SHARPE_DELTA} min`);
    }
    
    return {
      eligible: reasons.length === 0,
      reasons,
    };
  }
}

export const learningAggregatorService = new LearningAggregatorService();

export default learningAggregatorService;
