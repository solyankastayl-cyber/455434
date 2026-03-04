/**
 * MACRO IMPACT SERVICE — V2 Institutional
 * 
 * Horizon-specific impacts:
 * - Different coefficients for 30/90/180/365
 * - Regime-dependent scaling
 * - Volatility adaptation
 */

import { HorizonDays, RegimeType, HorizonImpact, MacroApplication } from '../contracts/index_pack.contract.js';

// ═══════════════════════════════════════════════════════════════
// HORIZON-SPECIFIC COEFFICIENTS
// 
// Learned from correlation analysis (real DXY data):
// - Optimal lag = 120 days
// - T10Y2Y strongest (-0.1241)
// 
// Coefficients increase with horizon (macro effects are slow)
// ═══════════════════════════════════════════════════════════════

const HORIZON_COEFFICIENTS: Record<HorizonDays, number> = {
  7: 0.01,      // Minimal effect on short term
  14: 0.02,
  30: 0.03,     // Base
  90: 0.05,     // Stronger at 90 days
  180: 0.07,    // Even stronger
  365: 0.10,    // Maximum at annual horizon
};

// ═══════════════════════════════════════════════════════════════
// REGIME BOOST FACTORS
// 
// Macro effects are stronger in certain regimes
// ═══════════════════════════════════════════════════════════════

const REGIME_BOOSTS: Record<RegimeType, number> = {
  'EASING': 1.0,
  'TIGHTENING': 1.3,     // Tightening has stronger effect
  'STRESS': 1.8,         // Stress amplifies everything
  'NEUTRAL': 0.7,        // Neutral dampens
  'NEUTRAL_MIXED': 0.9,
  'RECOVERY': 1.1,
  'EXPANSION': 1.2,
};

// ═══════════════════════════════════════════════════════════════
// COMPUTE HORIZON IMPACT
// ═══════════════════════════════════════════════════════════════

export function computeHorizonImpact(
  horizonDays: HorizonDays,
  scoreSigned: number,
  regime: RegimeType,
  confidence: number,
  volatilityScale: number = 1.0
): HorizonImpact {
  const coefficient = HORIZON_COEFFICIENTS[horizonDays] || 0.03;
  const regimeBoost = REGIME_BOOSTS[regime] || 1.0;
  
  // Base impact formula:
  // impact = scoreSigned × coefficient × regimeBoost × confidence × volScale
  const rawImpact = scoreSigned * coefficient * regimeBoost * confidence * volatilityScale;
  
  // Convert to percentage
  const impactPct = Math.round(rawImpact * 10000) / 100; // In %
  const impactBps = Math.round(rawImpact * 10000);       // In basis points
  
  // Band widening for stress regimes
  let bandWidenPct: number | undefined;
  if (regime === 'STRESS' || regime === 'TIGHTENING') {
    bandWidenPct = Math.abs(scoreSigned) * 0.1 * regimeBoost * 100; // Widen bands
  }
  
  return {
    horizonDays,
    impactPct,
    impactBps,
    bandWidenPct,
    confidence,
    coefficient,
    regimeBoost,
  };
}

// ═══════════════════════════════════════════════════════════════
// COMPUTE ALL HORIZON IMPACTS
// ═══════════════════════════════════════════════════════════════

export function computeAllHorizonImpacts(
  scoreSigned: number,
  regime: RegimeType,
  confidence: number,
  volatilityScale: number = 1.0
): HorizonImpact[] {
  const horizons: HorizonDays[] = [7, 14, 30, 90, 180, 365];
  
  return horizons.map(h => 
    computeHorizonImpact(h, scoreSigned, regime, confidence, volatilityScale)
  );
}

// ═══════════════════════════════════════════════════════════════
// GET APPLICATION METHOD
// ═══════════════════════════════════════════════════════════════

export function getMacroApplication(
  horizonImpact: HorizonImpact,
  regime: RegimeType
): MacroApplication {
  // Choose method based on regime
  let method: 'PATH_SHIFT' | 'BAND_RESHAPE' | 'MIXTURE' = 'PATH_SHIFT';
  
  if (regime === 'STRESS' || Math.abs(horizonImpact.impactPct) > 2) {
    method = 'BAND_RESHAPE';
  } else if (regime === 'NEUTRAL_MIXED') {
    method = 'MIXTURE';
  }
  
  // Clamp limits (prevent extreme adjustments)
  const clamp = {
    minPct: -5.0,
    maxPct: 5.0,
  };
  
  // Apply clamp
  const appliedImpact = Math.max(clamp.minPct, Math.min(clamp.maxPct, horizonImpact.impactPct));
  
  return {
    method,
    clamp,
    appliedImpact,
  };
}

// ═══════════════════════════════════════════════════════════════
// VOLATILITY SCALE CALCULATOR
// ═══════════════════════════════════════════════════════════════

export function computeVolatilityScale(
  realizedVol: number,
  longTermVol: number
): number {
  if (longTermVol <= 0) return 1.0;
  
  const ratio = realizedVol / longTermVol;
  
  // Clamp to reasonable range [0.5, 2.0]
  return Math.max(0.5, Math.min(2.0, ratio));
}
