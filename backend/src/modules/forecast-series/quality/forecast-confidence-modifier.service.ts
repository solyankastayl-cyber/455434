/**
 * FORECAST CONFIDENCE MODIFIER SERVICE
 * ====================================
 * 
 * V3.8: Auto Confidence Modifier (Self-Defense Layer)
 * 
 * Adjusts forecast confidence based on:
 * - Health state (HEALTHY/DEGRADING/CRITICAL)
 * - Rolling win rate
 * - Horizon (longer = less certain)
 * 
 * This is a POST-prediction safety layer.
 * Does NOT modify raw model output or training.
 */

import type { DriftState } from './forecast-drift.service.js';

export type HealthState = 'HEALTHY' | 'DEGRADING' | 'CRITICAL';

export interface ConfidenceModifierInput {
  rawConfidence: number;      // 0..1 (after calibration)
  horizon: '1D' | '7D' | '30D';
  healthState: HealthState;
  rollingWinRate?: number;    // 0..1
  historicalWinRate?: number; // 0..1
  drift?: number;             // 0..1
}

export interface ConfidenceModifierResult {
  adjustedConfidence: number;
  modifier: number;           // Final multiplier applied
  reasons: Array<{
    code: string;
    value: number;
    note?: string;
  }>;
}

// Health state multipliers
const HEALTH_MULTIPLIERS: Record<HealthState, number> = {
  HEALTHY: 1.0,
  DEGRADING: 0.85,
  CRITICAL: 0.65,
};

// Horizon dampening (longer horizons = less certain)
const HORIZON_MULTIPLIERS: Record<string, number> = {
  '1D': 1.00,
  '7D': 0.92,
  '30D': 0.86,
};

export class ForecastConfidenceModifierService {
  /**
   * Apply confidence modifier based on health state
   */
  apply(input: ConfidenceModifierInput): ConfidenceModifierResult {
    const reasons: ConfidenceModifierResult['reasons'] = [];
    const base = this.clamp01(input.rawConfidence);

    // 1) Health multiplier (main safety layer)
    const healthMult = HEALTH_MULTIPLIERS[input.healthState] || 1.0;
    reasons.push({ code: 'HEALTH_MULT', value: healthMult });

    // 2) Rolling WinRate adjustment (soft adaptation)
    // If rolling < 50% — reduce confidence
    // If rolling > 55% — slight boost
    let qualityMult = 1.0;
    const rw = typeof input.rollingWinRate === 'number' 
      ? this.clamp01(input.rollingWinRate) 
      : null;
    
    if (rw !== null) {
      if (rw < 0.45) qualityMult = 0.82;
      else if (rw < 0.50) qualityMult = 0.90;
      else if (rw < 0.55) qualityMult = 1.00;
      else qualityMult = 1.05; // Slight boost for good performance
      
      reasons.push({ 
        code: 'ROLLING_WR_MULT', 
        value: qualityMult, 
        note: `rolling=${rw.toFixed(3)}` 
      });
    }

    // 3) Horizon dampening (longer = less certain)
    const horizonMult = HORIZON_MULTIPLIERS[input.horizon] || 1.0;
    reasons.push({ code: 'HORIZON_MULT', value: horizonMult });

    // Calculate final modifier
    const modifier = healthMult * qualityMult * horizonMult;
    const adjustedConfidence = this.clamp01(base * modifier);

    return {
      adjustedConfidence,
      modifier,
      reasons,
    };
  }

  /**
   * Clamp value to 0..1 range
   */
  private clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }
}

// Singleton instance
let serviceInstance: ForecastConfidenceModifierService | null = null;

export function getForecastConfidenceModifierService(): ForecastConfidenceModifierService {
  if (!serviceInstance) {
    serviceInstance = new ForecastConfidenceModifierService();
  }
  return serviceInstance;
}

console.log('[ForecastConfidenceModifierService] V3.8 Auto Confidence Modifier loaded');
