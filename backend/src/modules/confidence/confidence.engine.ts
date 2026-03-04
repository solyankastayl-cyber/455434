/**
 * PHASE 2.3 — Confidence Decay Engine
 * =====================================
 * 
 * Rule-based confidence decay based on historical accuracy.
 * 
 * FORMULA (LOCKED v1):
 * -------------------
 * confirmationRate = confirmed / total
 * decayFactor = clamp(confirmationRate, 0.3, 1.0)
 * adjustedConfidence = rawConfidence × decayFactor
 * 
 * RULES:
 * - If total < minSampleSize: decayFactor = 0.5 (neutral)
 * - decayFactor never below 0.3 (system doesn't "die")
 * - decayFactor never above 1.0
 */

import { DecayConfig, DEFAULT_DECAY_CONFIG } from './confidence.types.js';

// ═══════════════════════════════════════════════════════════════
// CORE DECAY CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Compute decay factor from historical stats
 */
export function computeDecayFactor(
  confirmed: number,
  total: number,
  config: DecayConfig = DEFAULT_DECAY_CONFIG
): number {
  // Not enough samples → neutral decay
  if (total < config.minSampleSize) {
    return 0.5;
  }

  // Calculate confirmation rate
  const rate = confirmed / total;

  // Clamp to [minDecay, maxDecay]
  return Math.max(config.minDecay, Math.min(config.maxDecay, rate));
}

/**
 * Apply decay to raw confidence
 */
export function applyDecay(
  rawConfidence: number,
  decayFactor: number
): number {
  return Math.round((rawConfidence * decayFactor) * 1000) / 1000;
}

// ═══════════════════════════════════════════════════════════════
// VERDICT-SPECIFIC DECAY
// ═══════════════════════════════════════════════════════════════

export interface VerdictDecay {
  verdict: string;
  confirmed: number;
  diverged: number;
  total: number;
  decayFactor: number;
}

/**
 * Compute decay factors by verdict type
 */
export function computeDecayByVerdict(
  stats: Array<{ verdict: string; confirmed: number; diverged: number }>,
  config: DecayConfig = DEFAULT_DECAY_CONFIG
): Map<string, VerdictDecay> {
  const result = new Map<string, VerdictDecay>();

  for (const stat of stats) {
    const total = stat.confirmed + stat.diverged;
    const decayFactor = computeDecayFactor(stat.confirmed, total, config);

    result.set(stat.verdict, {
      verdict: stat.verdict,
      confirmed: stat.confirmed,
      diverged: stat.diverged,
      total,
      decayFactor,
    });
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// REGIME-AWARE DECAY (future extension)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute decay with regime consideration
 * (For now, same as basic decay - will be extended in Phase 3)
 */
export function computeDecayWithRegime(
  confirmed: number,
  total: number,
  regime: string,
  config: DecayConfig = DEFAULT_DECAY_CONFIG
): number {
  // TODO: Add regime-specific adjustments in Phase 3
  // For now, just use base decay
  return computeDecayFactor(confirmed, total, config);
}

console.log('[Phase 2.3] Confidence Decay Engine loaded');
