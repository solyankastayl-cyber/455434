/**
 * P1.4 — Volatility Regime Service
 * 
 * Main entry point for volatility intelligence.
 * Combines: features → classifier → policy
 * 
 * Does NOT affect direction.
 * Only scales risk (size, confidence).
 */

import type { DailyCandle, VolatilityResult, VolatilityApplied } from './volatility.types.js';
import { computeVolatilityFeatures } from './volatility.calculator.js';
import { classifyVolatilityRegime, getRegimeLabel, getRegimeColor } from './volatility.classifier.js';
import { getVolatilityPolicy, getVolatilityBlockers, generateVolatilityExplain } from './volatility.policy.js';

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export class VolatilityRegimeService {
  /**
   * Evaluate volatility regime from candles.
   * Returns regime classification + risk modifiers.
   */
  evaluate(candles: DailyCandle[]): VolatilityResult {
    // Compute features
    const features = computeVolatilityFeatures(candles);

    // Classify regime
    const regime = classifyVolatilityRegime(features);

    // Get policy
    const policy = getVolatilityPolicy(regime);

    // Get blockers
    const blockers = getVolatilityBlockers(regime, features);

    // Generate explanation
    const explain = generateVolatilityExplain(regime, features, policy);

    return {
      regime,
      features,
      policy,
      blockers,
      explain,
    };
  }

  /**
   * Apply volatility modifiers to size and confidence.
   * This is a pure function — does not modify direction.
   */
  applyModifiers(
    result: VolatilityResult,
    sizeBefore: number,
    confBefore: number,
    maxSize: number = 1.0
  ): VolatilityApplied {
    const { policy } = result;

    // Apply size multiplier
    let sizeAfter = sizeBefore * policy.sizeMultiplier;
    sizeAfter = Math.max(0, Math.min(maxSize, sizeAfter));

    // Apply confidence penalty
    let confAfter = confBefore - policy.confidencePenaltyPp;
    confAfter = Math.max(0, Math.min(1, confAfter));

    return {
      sizeBefore,
      sizeAfter,
      confBefore,
      confAfter,
    };
  }

  /**
   * Get regime label for UI
   */
  getLabel(result: VolatilityResult): string {
    return getRegimeLabel(result.regime);
  }

  /**
   * Get regime color for UI
   */
  getColor(result: VolatilityResult): string {
    return getRegimeColor(result.regime);
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _instance: VolatilityRegimeService | null = null;

export function getVolatilityRegimeService(): VolatilityRegimeService {
  if (!_instance) {
    _instance = new VolatilityRegimeService();
  }
  return _instance;
}

// ═══════════════════════════════════════════════════════════════
// RE-EXPORTS
// ═══════════════════════════════════════════════════════════════

export * from './volatility.types.js';
export { computeVolatilityFeatures } from './volatility.calculator.js';
export { classifyVolatilityRegime, getRegimeLabel, getRegimeColor } from './volatility.classifier.js';
export { getVolatilityPolicy, getVolatilityBlockers } from './volatility.policy.js';
export { VolatilityAttributionService, getVolatilityAttributionService } from './volatility.attribution.service.js';
