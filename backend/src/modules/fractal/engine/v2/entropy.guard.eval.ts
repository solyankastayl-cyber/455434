/**
 * BLOCK 36.10.2 — Entropy Guard Evaluation (+ optional EMA state)
 * 
 * Core evaluation logic for the Entropy Guard.
 * Takes horizon signals and config, returns scale multiplier.
 */

import {
  EntropyGuardConfig,
  EntropyGuardResult,
  HorizonSignal,
  entropyNorm3,
  entropyScale,
  horizonSignalsToProbs,
} from "./entropy.guard.js";

export interface EntropyEmaState {
  emaEntropy: number; // 0..1
  initialized: boolean;
}

/**
 * Create a fresh EMA state
 */
export function createEntropyEmaState(): EntropyEmaState {
  return {
    emaEntropy: 0,
    initialized: false,
  };
}

/**
 * Evaluate entropy guard for given signals
 * Returns scale multiplier and metadata
 */
export function evalEntropyGuard(
  signals: HorizonSignal[],
  cfg: EntropyGuardConfig,
  ema?: EntropyEmaState
): EntropyGuardResult {
  // If guard disabled, return full scale
  if (!cfg.enabled) {
    return {
      entropyNorm: 0,
      probs: { LONG: 0, SHORT: 0, NEUTRAL: 1 },
      scale: 1,
      dominance: 1,
      reason: "OK",
    };
  }

  // Convert signals to probability distribution
  const probs = horizonSignalsToProbs(signals, cfg);
  
  // Calculate normalized entropy
  let e = entropyNorm3(probs);

  // Apply EMA smoothing if enabled
  if (cfg.emaEnabled && ema) {
    if (!ema.initialized) {
      ema.emaEntropy = e;
      ema.initialized = true;
    } else {
      ema.emaEntropy = cfg.emaAlpha * e + (1 - cfg.emaAlpha) * ema.emaEntropy;
    }
    e = ema.emaEntropy;
  }

  // Calculate base scale from entropy
  let scale = entropyScale(e, cfg);
  
  // Calculate dominance (max probability)
  const dominance = Math.max(probs.LONG, probs.SHORT, probs.NEUTRAL);

  // Determine reason based on entropy level
  let reason: EntropyGuardResult["reason"] = "OK";
  if (e >= cfg.hardEntropy) reason = "HARD";
  else if (e >= cfg.warnEntropy) reason = "WARN";

  // Apply dominance penalty if enabled
  // High dominance in itself is not bad, but in MC tail it tends to cluster.
  // Apply a small additional reduction to reduce path risk.
  if (cfg.dominancePenaltyEnabled && dominance >= cfg.dominanceHard) {
    scale *= 1 - cfg.dominancePenalty;
    reason = "DOMINANCE";
  }

  // Clamp scale to valid range
  if (scale < cfg.minScale) scale = cfg.minScale;
  if (scale > 1) scale = 1;

  return {
    entropyNorm: e,
    probs,
    scale,
    dominance,
    reason,
  };
}

/**
 * Batch evaluation for simulation: process array of signal sets
 * Returns array of scales and optional telemetry
 */
export function evalEntropyGuardBatch(
  signalSets: HorizonSignal[][],
  cfg: EntropyGuardConfig,
  collectTelemetry = false
): {
  scales: number[];
  telemetry?: Array<{
    entropyNorm: number;
    scale: number;
    reason: string;
    dominance: number;
  }>;
} {
  const ema = createEntropyEmaState();
  const scales: number[] = [];
  const telemetry: Array<{
    entropyNorm: number;
    scale: number;
    reason: string;
    dominance: number;
  }> = [];

  for (const signals of signalSets) {
    const result = evalEntropyGuard(signals, cfg, ema);
    scales.push(result.scale);

    if (collectTelemetry) {
      telemetry.push({
        entropyNorm: result.entropyNorm,
        scale: result.scale,
        reason: result.reason,
        dominance: result.dominance,
      });
    }
  }

  return collectTelemetry ? { scales, telemetry } : { scales };
}
