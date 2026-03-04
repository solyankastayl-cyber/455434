/**
 * BLOCK 39.4 — Institutional Score Service (Module Self-Rating)
 * 
 * Fractal rates itself for M-Brain comparison and risk assessment.
 * Components: reliability, stability, rolling, calibration, tail risk
 */

import {
  InstitutionalScoreConfig,
  InstitutionalScoreResult,
  RiskProfile,
  DEFAULT_INSTITUTIONAL_SCORE_CONFIG,
} from '../contracts/institutional.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface InstitutionalInputs {
  reliability: number;        // 0..1 from reliability service
  stability: number;          // 0..1 from PSS
  rollingPassRate: number;    // 0..1 rolling validation pass rate
  calibrationQuality: number; // 0..1 from calibration health
  tailRiskHealth: number;     // 0..1 from MC tail analysis
}

// ═══════════════════════════════════════════════════════════════
// Institutional Score Computation
// ═══════════════════════════════════════════════════════════════

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Compute institutional score (module self-rating)
 */
export function computeInstitutionalScore(
  inputs: InstitutionalInputs,
  cfg: InstitutionalScoreConfig = DEFAULT_INSTITUTIONAL_SCORE_CONFIG
): InstitutionalScoreResult {
  const w = cfg.weights;
  
  // Weighted sum
  const score = clamp01(
    w.reliability * clamp01(inputs.reliability) +
    w.stability * clamp01(inputs.stability) +
    w.rollingPassRate * clamp01(inputs.rollingPassRate) +
    w.calibrationQuality * clamp01(inputs.calibrationQuality) +
    w.tailRiskHealth * clamp01(inputs.tailRiskHealth)
  );
  
  // Determine risk profile
  let riskProfile: RiskProfile;
  if (score >= 0.75) {
    riskProfile = 'CONSERVATIVE';  // Safe to use at full capacity
  } else if (score >= 0.55) {
    riskProfile = 'MODERATE';      // Use with some caution
  } else if (score >= 0.35) {
    riskProfile = 'AGGRESSIVE';    // Use with reduced exposure
  } else {
    riskProfile = 'DEGRADED';      // Consider pausing
  }
  
  // Recommendation
  let recommendation: string;
  switch (riskProfile) {
    case 'CONSERVATIVE':
      recommendation = 'Module operating well. Full exposure allowed.';
      break;
    case 'MODERATE':
      recommendation = 'Module stable but not optimal. Consider 70% exposure.';
      break;
    case 'AGGRESSIVE':
      recommendation = 'Module showing stress. Reduce to 40% exposure.';
      break;
    case 'DEGRADED':
      recommendation = 'Module degraded. Consider pausing trading.';
      break;
  }
  
  return {
    score: Math.round(score * 1000) / 1000,
    riskProfile,
    components: {
      reliability: Math.round(inputs.reliability * 1000) / 1000,
      stability: Math.round(inputs.stability * 1000) / 1000,
      rollingPassRate: Math.round(inputs.rollingPassRate * 1000) / 1000,
      calibrationQuality: Math.round(inputs.calibrationQuality * 1000) / 1000,
      tailRiskHealth: Math.round(inputs.tailRiskHealth * 1000) / 1000,
    },
    recommendation,
  };
}

// ═══════════════════════════════════════════════════════════════
// Quick Score with Defaults
// ═══════════════════════════════════════════════════════════════

/**
 * Quick institutional score with partial inputs
 * Missing inputs use neutral default (0.6)
 */
export function quickInstitutionalScore(
  partial: Partial<InstitutionalInputs>
): InstitutionalScoreResult {
  const inputs: InstitutionalInputs = {
    reliability: partial.reliability ?? 0.6,
    stability: partial.stability ?? 0.6,
    rollingPassRate: partial.rollingPassRate ?? 0.6,
    calibrationQuality: partial.calibrationQuality ?? 0.6,
    tailRiskHealth: partial.tailRiskHealth ?? 0.6,
  };
  return computeInstitutionalScore(inputs);
}

// ═══════════════════════════════════════════════════════════════
// Score-to-Exposure Mapping
// ═══════════════════════════════════════════════════════════════

/**
 * Map institutional score to max allowed exposure
 */
export function scoreToMaxExposure(score: number): number {
  if (score >= 0.75) return 1.0;
  if (score >= 0.55) return 0.7;
  if (score >= 0.35) return 0.4;
  return 0.15;
}
