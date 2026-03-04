/**
 * BLOCK 39.5 — Phase-Sensitive Risk Multiplier Service
 * 
 * Adjusts position sizing based on current market phase.
 * Works with phase classifier from 37.3.
 */

import {
  MarketPhase,
  PhaseRiskConfig,
  DEFAULT_PHASE_RISK_CONFIG,
} from '../contracts/institutional.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Phase Risk Multiplier
// ═══════════════════════════════════════════════════════════════

const clamp = (x: number, min: number, max: number): number => 
  Math.max(min, Math.min(max, x));

/**
 * Get risk multiplier for market phase
 */
export function getPhaseRiskMultiplier(
  phase: MarketPhase,
  cfg: PhaseRiskConfig = DEFAULT_PHASE_RISK_CONFIG
): number {
  return cfg.multipliers[phase] ?? 0.8;
}

/**
 * Apply reliability floor to phase multiplier
 * If reliability is low, cap the phase boost
 */
export function getAdjustedPhaseMultiplier(
  phase: MarketPhase,
  reliability: number,
  cfg: PhaseRiskConfig = DEFAULT_PHASE_RISK_CONFIG
): number {
  const baseMult = getPhaseRiskMultiplier(phase, cfg);
  
  // If reliability is low, don't allow full boost
  if (reliability < cfg.reliabilityFloor) {
    const reliabilityFactor = reliability / cfg.reliabilityFloor;
    // Blend toward 0.8 (neutral) when reliability is low
    return 0.8 + (baseMult - 0.8) * reliabilityFactor;
  }
  
  return baseMult;
}

// ═══════════════════════════════════════════════════════════════
// Phase-Aware Signal Adjustment
// ═══════════════════════════════════════════════════════════════

export interface PhaseAdjustedSignal {
  originalExposure: number;
  phaseMultiplier: number;
  adjustedExposure: number;
  phase: MarketPhase;
  phaseReason: string;
}

/**
 * Apply phase-sensitive adjustment to exposure
 */
export function applyPhaseAdjustment(
  exposure: number,
  phase: MarketPhase,
  reliability: number = 0.7,
  cfg: PhaseRiskConfig = DEFAULT_PHASE_RISK_CONFIG
): PhaseAdjustedSignal {
  const phaseMultiplier = getAdjustedPhaseMultiplier(phase, reliability, cfg);
  const adjustedExposure = clamp(exposure * phaseMultiplier, 0, 1);
  
  let phaseReason: string;
  switch (phase) {
    case 'ACCUMULATION':
      phaseReason = 'Normal risk: accumulation phase, stable';
      break;
    case 'MARKUP':
      phaseReason = 'Elevated risk: uptrend, favorable conditions';
      break;
    case 'DISTRIBUTION':
      phaseReason = 'Reduced risk: distribution, potential reversal';
      break;
    case 'MARKDOWN':
      phaseReason = 'Reduced risk: downtrend, elevated volatility';
      break;
    case 'CAPITULATION':
      phaseReason = 'Minimum risk: capitulation, extreme conditions';
      break;
    case 'RECOVERY':
      phaseReason = 'Cautious risk: recovery, still volatile';
      break;
    default:
      phaseReason = 'Unknown phase: using conservative default';
  }
  
  return {
    originalExposure: Math.round(exposure * 1000) / 1000,
    phaseMultiplier: Math.round(phaseMultiplier * 1000) / 1000,
    adjustedExposure: Math.round(adjustedExposure * 1000) / 1000,
    phase,
    phaseReason,
  };
}

// ═══════════════════════════════════════════════════════════════
// Phase-Horizon Policy (which horizons to emphasize)
// ═══════════════════════════════════════════════════════════════

export interface PhaseHorizonPolicy {
  phase: MarketPhase;
  preferredHorizons: Array<7 | 14 | 30 | 60>;
  horizonBoosts: Record<7 | 14 | 30 | 60, number>;
  reason: string;
}

/**
 * Get horizon preference based on market phase
 */
export function getPhaseHorizonPolicy(phase: MarketPhase): PhaseHorizonPolicy {
  switch (phase) {
    case 'ACCUMULATION':
      return {
        phase,
        preferredHorizons: [30, 60],
        horizonBoosts: { 7: 0.8, 14: 0.9, 30: 1.0, 60: 1.0 },
        reason: 'Sideways market: longer horizons more reliable',
      };
    case 'MARKUP':
      return {
        phase,
        preferredHorizons: [30, 60],
        horizonBoosts: { 7: 0.9, 14: 1.0, 30: 1.1, 60: 1.1 },
        reason: 'Uptrend: emphasize longer trend horizons',
      };
    case 'DISTRIBUTION':
      return {
        phase,
        preferredHorizons: [7, 14],
        horizonBoosts: { 7: 1.1, 14: 1.1, 30: 0.9, 60: 0.8 },
        reason: 'Potential reversal: shorter horizons for agility',
      };
    case 'MARKDOWN':
      return {
        phase,
        preferredHorizons: [7, 14],
        horizonBoosts: { 7: 1.1, 14: 1.0, 30: 0.9, 60: 0.9 },
        reason: 'Downtrend: shorter horizons with tight caps',
      };
    case 'CAPITULATION':
      return {
        phase,
        preferredHorizons: [7, 14],
        horizonBoosts: { 7: 1.0, 14: 1.0, 30: 0.8, 60: 0.7 },
        reason: 'Extreme conditions: short horizons, reduced all',
      };
    case 'RECOVERY':
      return {
        phase,
        preferredHorizons: [14, 30],
        horizonBoosts: { 7: 0.9, 14: 1.0, 30: 1.0, 60: 0.9 },
        reason: 'Recovery: balanced approach, watch for reversal',
      };
    default:
      return {
        phase,
        preferredHorizons: [30, 60],
        horizonBoosts: { 7: 1.0, 14: 1.0, 30: 1.0, 60: 1.0 },
        reason: 'Unknown phase: use balanced default',
      };
  }
}
