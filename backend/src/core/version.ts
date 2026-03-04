/**
 * SYSTEM VERSION & FREEZE STATE
 * v2.2 Production Baseline — FROZEN
 * v2.3 Capital Scaling — SHADOW (development)
 */

export const SYSTEM_VERSION = "2.2.0-production-baseline";
export const SYSTEM_FREEZE = true;
export const CAPITAL_SCALING_VERSION = "2.3.0-production";

/**
 * Freeze state prevents:
 * - Auto-promotion of adaptive params
 * - Changes to scenario priors
 * - MetaRisk cap modifications
 * - Quantile weight adjustments
 */
export function isSystemFrozen(): boolean {
  return SYSTEM_FREEZE;
}

export function getVersionInfo() {
  return {
    system: SYSTEM_VERSION,
    capitalScaling: CAPITAL_SCALING_VERSION,
    frozen: SYSTEM_FREEZE,
    timestamp: new Date().toISOString()
  };
}
