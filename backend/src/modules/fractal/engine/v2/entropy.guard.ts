/**
 * BLOCK 36.10.1 — Entropy Guard Contracts + Utils
 * 
 * Dynamic risk control via signal entropy measurement.
 * When horizons disagree (high entropy), reduce exposure.
 * When horizons agree (low entropy), allow full exposure.
 * 
 * This addresses the root cause of tail risk: risk concentration
 * when the assembler amplifies one horizon too aggressively.
 */

export type HorizonKey = "7" | "14" | "30" | "60";
export type Side = "LONG" | "SHORT" | "NEUTRAL";

export interface HorizonSignal {
  horizonDays: number;
  side: Side;
  // strength should be comparable across horizons (0..1)
  strength: number;
  // calibrated confidence (0..1)
  confidence: number;
}

export interface EntropyGuardConfig {
  enabled: boolean;

  // how much we trust confidence vs strength when building probabilities
  alphaStrength: number; // default 0.55
  alphaConf: number;     // default 0.45

  // entropy thresholds (0..1). higher entropy => more disagreement
  // H_norm = H / log(3)
  warnEntropy: number;    // default 0.55
  hardEntropy: number;    // default 0.75

  // scaling curve
  // if entropy <= warn => scale=1
  // if entropy >= hard => scale=minScale
  minScale: number;       // default 0.25

  // extra penalty if "top horizon dominates" too much
  dominancePenaltyEnabled: boolean; // default true
  dominanceHard: number;            // default 0.70 (max prob)
  dominancePenalty: number;         // default 0.20 (scale multiplier)

  // smoothing to avoid jitter
  emaEnabled: boolean;    // default true
  emaAlpha: number;       // default 0.25
}

export interface EntropyGuardResult {
  entropyNorm: number;     // 0..1
  probs: { LONG: number; SHORT: number; NEUTRAL: number };
  scale: number;           // 0..1 final position multiplier
  dominance: number;       // max probability
  reason: "OK" | "WARN" | "HARD" | "DOMINANCE";
}

const EPS = 1e-12;

function clamp01(x: number) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function softmax3(a: number, b: number, c: number) {
  const m = Math.max(a, b, c);
  const ea = Math.exp(a - m);
  const eb = Math.exp(b - m);
  const ec = Math.exp(c - m);
  const s = ea + eb + ec;
  return { LONG: ea / s, SHORT: eb / s, NEUTRAL: ec / s };
}

/**
 * Converts horizon signals into a probability distribution over sides.
 * We treat NEUTRAL as "mass" from weak/low-conf signals.
 */
export function horizonSignalsToProbs(
  signals: HorizonSignal[],
  cfg: EntropyGuardConfig
) {
  let longScore = 0;
  let shortScore = 0;
  let neutralScore = 0;

  for (const s of signals) {
    const strength = clamp01(s.strength);
    const conf = clamp01(s.confidence);

    // fused weight 0..1
    const w = clamp01(cfg.alphaStrength * strength + cfg.alphaConf * conf);

    if (s.side === "LONG") longScore += w;
    else if (s.side === "SHORT") shortScore += w;
    else neutralScore += w;
  }

  // Add small bias so softmax stable even if all zeros
  return softmax3(longScore + EPS, shortScore + EPS, neutralScore + EPS);
}

/**
 * Normalized Shannon entropy in [0..1] for 3-class probs.
 */
export function entropyNorm3(p: { LONG: number; SHORT: number; NEUTRAL: number }) {
  const { LONG, SHORT, NEUTRAL } = p;
  const H =
    -(LONG * Math.log(LONG + EPS) +
      SHORT * Math.log(SHORT + EPS) +
      NEUTRAL * Math.log(NEUTRAL + EPS));
  const Hmax = Math.log(3);
  return clamp01(H / Hmax);
}

/**
 * Linear scaling between warn..hard thresholds
 */
export function entropyScale(entropy: number, cfg: EntropyGuardConfig) {
  if (entropy <= cfg.warnEntropy) return 1.0;
  if (entropy >= cfg.hardEntropy) return cfg.minScale;

  // linear between warn..hard (can replace with curve later)
  const t = (entropy - cfg.warnEntropy) / (cfg.hardEntropy - cfg.warnEntropy);
  return 1.0 - t * (1.0 - cfg.minScale);
}

/**
 * Default entropy guard configuration
 */
export const DEFAULT_ENTROPY_GUARD_CONFIG: EntropyGuardConfig = {
  enabled: true,
  alphaStrength: 0.55,
  alphaConf: 0.45,
  warnEntropy: 0.55,
  hardEntropy: 0.75,
  minScale: 0.25,
  dominancePenaltyEnabled: true,
  dominanceHard: 0.70,
  dominancePenalty: 0.20,
  emaEnabled: true,
  emaAlpha: 0.25,
};
