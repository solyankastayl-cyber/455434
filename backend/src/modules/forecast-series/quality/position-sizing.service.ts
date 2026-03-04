/**
 * POSITION SIZING SERVICE
 * =======================
 * 
 * V3.9: Drift-based Position Sizing
 * V3.10: Deterministic Position Sizing Engine
 * 
 * Calculates recommended position size as % of capital.
 * 
 * Formula:
 * positionSize = baseRisk * confidenceFactor * driftFactor * volatilityFactor * riskCap
 * 
 * No Kelly criterion, no magic — just disciplined, deterministic sizing.
 */

import type { DriftState } from './forecast-drift.service.js';
import type { HealthState } from './forecast-confidence-modifier.service.js';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type NotionalHint = 'TINY' | 'SMALL' | 'MEDIUM' | 'LARGE';
export type Action = 'BUY' | 'SELL' | 'HOLD' | 'AVOID';

export interface PositionSizingInput {
  action: Action;
  confidence: number;             // 0..1 (after V3.8 modifier)
  driftState: DriftState;
  volatility?: number;            // Normalized 0..1 (optional)
  riskLevel?: RiskLevel;          // Default: MEDIUM
  horizon: '1D' | '7D' | '30D';
}

export interface PositionSizingResult {
  positionPct: number;            // 0..1 (% of capital)
  notionalHint: NotionalHint;     // Human-readable size category
  reasons: Array<{
    code: string;
    value: number;
    note?: string;
  }>;
}

// Drift factor: reduce position when model degrades
const DRIFT_SIZE_MULTIPLIERS: Record<DriftState, number> = {
  HEALTHY: 1.0,
  DEGRADING: 0.75,   // -25%
  CRITICAL: 0.50,    // -50%
};

// Risk caps per risk level
const RISK_CAPS: Record<RiskLevel, number> = {
  LOW: 0.020,        // 2% max
  MEDIUM: 0.015,     // 1.5% max
  HIGH: 0.010,       // 1% max
  EXTREME: 0.006,    // 0.6% max
};

// Base risk per horizon
const BASE_RISK: Record<string, number> = {
  '1D': 0.012,       // 1.2%
  '7D': 0.016,       // 1.6%
  '30D': 0.020,      // 2.0%
};

export class PositionSizingService {
  /**
   * Calculate position size
   */
  compute(input: PositionSizingInput): PositionSizingResult {
    const reasons: PositionSizingResult['reasons'] = [];
    const riskLevel = input.riskLevel || 'MEDIUM';

    // No trade for HOLD/AVOID
    if (input.action === 'HOLD' || input.action === 'AVOID') {
      return { 
        positionPct: 0, 
        notionalHint: 'TINY', 
        reasons: [{ code: 'NO_TRADE', value: 0 }] 
      };
    }

    // 1) Base risk budget per trade
    const baseRisk = BASE_RISK[input.horizon] || 0.015;
    reasons.push({ code: 'BASE_RISK', value: baseRisk });

    // 2) Risk cap (hard limit)
    const riskCap = RISK_CAPS[riskLevel];
    reasons.push({ code: 'RISK_CAP', value: riskCap });

    // 3) Drift factor (self-defense)
    const driftFactor = DRIFT_SIZE_MULTIPLIERS[input.driftState];
    reasons.push({ code: 'DRIFT_FACTOR', value: driftFactor });

    // 4) Confidence curve
    // Lower confidence = smaller position
    const c = this.clamp(input.confidence, 0, 1);
    let confMult: number;
    if (c < 0.50) confMult = 0.25;
    else if (c < 0.60) confMult = 0.45;
    else if (c < 0.70) confMult = 0.70;
    else if (c < 0.80) confMult = 0.90;
    else confMult = 1.00;
    
    reasons.push({ code: 'CONF_MULT', value: confMult, note: `c=${c.toFixed(3)}` });

    // 5) Volatility factor (inverse scaling)
    // High volatility = smaller position
    let volFactor = 1.0;
    if (typeof input.volatility === 'number' && Number.isFinite(input.volatility)) {
      const vol = this.clamp(input.volatility, 0, 1);
      volFactor = 1 - vol * 0.5; // vol=1 → -50%, vol=0 → no change
      reasons.push({ code: 'VOL_FACTOR', value: volFactor, note: `vol=${vol.toFixed(3)}` });
    }

    // Calculate raw position size
    const rawSize = baseRisk * confMult * driftFactor * volFactor;
    
    // Apply risk cap (hard ceiling)
    let positionPct = this.clamp(rawSize, 0, riskCap);
    
    // Hard floor: minimum 0.5%
    positionPct = Math.max(0.005, positionPct);
    
    // Hard ceiling: maximum 10%
    positionPct = Math.min(0.10, positionPct);

    // Determine notional hint
    const notionalHint = this.getNotionalHint(positionPct);

    return { positionPct, notionalHint, reasons };
  }

  /**
   * Get human-readable size category
   */
  private getNotionalHint(pct: number): NotionalHint {
    if (pct < 0.004) return 'TINY';
    if (pct < 0.008) return 'SMALL';
    if (pct < 0.014) return 'MEDIUM';
    return 'LARGE';
  }

  /**
   * Clamp value to range
   */
  private clamp(x: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, x));
  }
}

// Singleton instance
let serviceInstance: PositionSizingService | null = null;

export function getPositionSizingService(): PositionSizingService {
  if (!serviceInstance) {
    serviceInstance = new PositionSizingService();
  }
  return serviceInstance;
}

console.log('[PositionSizingService] V3.10 Position Sizing Engine loaded');
