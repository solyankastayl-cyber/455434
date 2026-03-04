/**
 * Exchange Horizon Bias — Time Decay Configuration
 * 
 * Controls how fresh outcomes are weighted more heavily than old ones.
 * 
 * Formula: w_i = exp(-ageDays / tau)
 * 
 * Anti-noise: effectiveSampleCount = (Σw)² / Σw²
 * If ESS < minEffectiveSamples → decay is invalid, fallback to raw
 */

export type ExchangeHorizon = '1D' | '7D' | '30D';

export interface BiasDecayConfig {
  enabled: boolean;
  minEffectiveSamples: number;
  tauDays: Record<ExchangeHorizon, number>;
}

/**
 * Load decay config from environment.
 */
export function loadBiasDecayConfig(): BiasDecayConfig {
  return {
    enabled: process.env.EXCH_BIAS_DECAY_ENABLED === 'true',
    minEffectiveSamples: Number(process.env.EXCH_BIAS_DECAY_MIN_EFFECTIVE_SAMPLES || 15),
    tauDays: {
      '1D': Number(process.env.EXCH_BIAS_DECAY_TAU_1D || 7),
      '7D': Number(process.env.EXCH_BIAS_DECAY_TAU_7D || 14),
      '30D': Number(process.env.EXCH_BIAS_DECAY_TAU_30D || 21),
    },
  };
}

/**
 * Decay state enum for audit logging.
 */
export type DecayState =
  | 'DISABLED'           // decay выключен через env
  | 'LOW_EFFECTIVE_SAMPLES' // включён, но ESS < threshold
  | 'ACTIVE'             // decay применён
  | 'STABLE';            // decay применён и ESS > 2×threshold

/**
 * Compute decay state from metrics.
 */
export function computeDecayState(
  decay: { enabled: boolean; valid: boolean; effectiveSampleCount: number },
  minEffectiveSamples: number
): DecayState {
  if (!decay.enabled) return 'DISABLED';
  if (!decay.valid) return 'LOW_EFFECTIVE_SAMPLES';
  if (decay.effectiveSampleCount > minEffectiveSamples * 2) return 'STABLE';
  return 'ACTIVE';
}

console.log('[Exchange ML] Decay config module loaded');
