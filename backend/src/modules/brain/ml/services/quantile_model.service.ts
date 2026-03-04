/**
 * P8.0-B1 — Baseline Quantile Model Service
 * 
 * Returns empirical quantiles as baseline (before training MoE).
 * Uses historical DXY return distributions.
 */

import {
  Horizon,
  HORIZONS,
  HorizonForecast,
  enforceQuantileMonotonicity,
  clampReturn,
  computeTailRisk,
} from '../contracts/quantile_forecast.contract.js';

// ═══════════════════════════════════════════════════════════════
// EMPIRICAL BASELINES (from historical DXY data)
// ═══════════════════════════════════════════════════════════════

/**
 * Empirical return distributions for DXY (based on historical analysis)
 * These are placeholder values - will be replaced by trained MoE
 */
const BASELINE_QUANTILES: Record<Horizon, {
  mean: number;
  q05: number;
  q50: number;
  q95: number;
}> = {
  '30D': {
    mean: -0.002,
    q05: -0.025,
    q50: -0.003,
    q95: 0.018,
  },
  '90D': {
    mean: -0.008,
    q05: -0.055,
    q50: -0.010,
    q95: 0.035,
  },
  '180D': {
    mean: -0.015,
    q05: -0.085,
    q50: -0.018,
    q95: 0.050,
  },
  '365D': {
    mean: -0.025,
    q05: -0.120,
    q50: -0.030,
    q95: 0.065,
  },
};

/**
 * Regime-specific adjustments (multipliers)
 * Apply on top of baseline
 */
const REGIME_ADJUSTMENTS: Record<string, {
  meanShift: number;
  spreadScale: number;
}> = {
  EASING: { meanShift: -0.005, spreadScale: 0.9 },      // DXY weakens, less volatile
  TIGHTENING: { meanShift: 0.008, spreadScale: 1.1 },  // DXY strengthens, more volatile
  STRESS: { meanShift: 0.015, spreadScale: 1.5 },      // Flight to USD, high vol
  NEUTRAL: { meanShift: 0, spreadScale: 1.0 },         // No adjustment
  NEUTRAL_MIXED: { meanShift: 0, spreadScale: 1.1 },   // Slight vol increase
};

// ═══════════════════════════════════════════════════════════════
// BASELINE MODEL SERVICE
// ═══════════════════════════════════════════════════════════════

export class BaselineQuantileModelService {
  
  /**
   * Get baseline forecast for all horizons
   */
  getForecast(
    regimeProbs: Record<string, number>,
    featureVector?: number[]
  ): Record<Horizon, HorizonForecast> {
    const result: Record<string, HorizonForecast> = {};
    
    for (const horizon of HORIZONS) {
      result[horizon] = this.getForecastForHorizon(horizon, regimeProbs, featureVector);
    }
    
    return result as Record<Horizon, HorizonForecast>;
  }
  
  /**
   * Get forecast for single horizon using regime-weighted mixture
   */
  private getForecastForHorizon(
    horizon: Horizon,
    regimeProbs: Record<string, number>,
    featureVector?: number[]
  ): HorizonForecast {
    const baseline = BASELINE_QUANTILES[horizon];
    
    // Compute regime-weighted adjustments
    let meanShift = 0;
    let spreadScale = 0;
    let totalProb = 0;
    
    for (const [regime, prob] of Object.entries(regimeProbs)) {
      if (prob <= 0) continue;
      
      const adj = REGIME_ADJUSTMENTS[regime] || REGIME_ADJUSTMENTS['NEUTRAL'];
      meanShift += prob * adj.meanShift;
      spreadScale += prob * adj.spreadScale;
      totalProb += prob;
    }
    
    // Normalize if probs don't sum to 1
    if (totalProb > 0 && totalProb !== 1) {
      meanShift /= totalProb;
      spreadScale /= totalProb;
    }
    if (spreadScale === 0) spreadScale = 1;
    
    // Apply adjustments
    const adjustedMean = baseline.mean + meanShift;
    const adjustedQ50 = baseline.q50 + meanShift;
    
    // Scale spread around median
    const lowerSpread = (baseline.q50 - baseline.q05) * spreadScale;
    const upperSpread = (baseline.q95 - baseline.q50) * spreadScale;
    
    let q05 = adjustedQ50 - lowerSpread;
    let q95 = adjustedQ50 + upperSpread;
    
    // Apply feature-based micro-adjustments (if features available)
    if (featureVector && featureVector.length >= 4) {
      // Use macro_scoreSigned (index 0) for direction hint
      const macroScore = featureVector[0];
      const scoreAdjustment = macroScore * 0.01; // Small adjustment
      
      q05 += scoreAdjustment;
      q95 += scoreAdjustment;
    }
    
    // Clamp to reasonable bounds
    q05 = clampReturn(q05, horizon);
    q95 = clampReturn(q95, horizon);
    const mean = clampReturn(adjustedMean, horizon);
    let q50 = clampReturn(adjustedQ50, horizon);
    
    // Enforce monotonicity
    [q05, q50, q95] = enforceQuantileMonotonicity(q05, q50, q95);
    
    // Compute tail risk
    const tailRisk = computeTailRisk(q05, q50, horizon);
    
    return {
      mean: Math.round(mean * 10000) / 10000,
      q05: Math.round(q05 * 10000) / 10000,
      q50: Math.round(q50 * 10000) / 10000,
      q95: Math.round(q95 * 10000) / 10000,
      tailRisk: Math.round(tailRisk * 100) / 100,
    };
  }
  
  /**
   * Check if baseline model is available (always true)
   */
  isAvailable(): boolean {
    return true;
  }
  
  /**
   * Get model info
   */
  getModelInfo(): {
    version: string;
    isBaseline: boolean;
    trainedAt: string | null;
  } {
    return {
      version: 'baseline_v1',
      isBaseline: true,
      trainedAt: null,
    };
  }
}

// Singleton
let instance: BaselineQuantileModelService | null = null;

export function getBaselineQuantileModelService(): BaselineQuantileModelService {
  if (!instance) {
    instance = new BaselineQuantileModelService();
  }
  return instance;
}
