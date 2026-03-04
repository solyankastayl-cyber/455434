/**
 * Risk Score Calculator
 * 
 * Deterministic risk score calculation based on exposure
 */

import { G3_CONFIG } from '../g3.config.js';
import { ExposureResult } from '../g3.types.js';

/**
 * Compute AML risk score (0-100)
 * 
 * Linear, deterministic, no ML required
 */
export function computeRiskScore(exposure: ExposureResult): number {
  const shares = exposure.byBucketShare;

  let score = 0;

  // Mixer exposure (0-25% normalized)
  score +=
    Math.min(1, shares.MIXER / 0.25) * G3_CONFIG.scoreWeights.mixerExposure;

  // Sanctioned exposure (0-1% normalized)
  score +=
    Math.min(1, shares.SANCTIONED / 0.01) *
    G3_CONFIG.scoreWeights.sanctionedExposure;

  // High-risk exposure (0-25% normalized)
  score +=
    Math.min(1, shares.HIGH_RISK / 0.25) *
    G3_CONFIG.scoreWeights.highRiskExposure;

  // Bridge exposure (0-60% normalized)
  score +=
    Math.min(1, shares.BRIDGE / 0.6) * G3_CONFIG.scoreWeights.bridgeExposure;

  // Unknown exposure (0-80% normalized)
  score +=
    Math.min(1, shares.UNKNOWN / 0.8) * G3_CONFIG.scoreWeights.unknownExposure;

  // Clamp to [0, 100] and round
  return Math.max(0, Math.min(100, Math.round(score)));
}
