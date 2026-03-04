/**
 * BLOCK 29.31: Horizon Selector
 * Picks optimal horizon (14/30/60) based on match stability
 */

export interface ForwardStatsByHorizon {
  [horizon: number]: {
    horizon: number;
    p10: number;
    p50: number;
    p90: number;
    mean: number;
    n: number;
    stability: number;
  };
}

export type HorizonPolicy = 'STABILITY' | 'BEST_SHARPE' | 'FIXED';

export interface HorizonSelectorParams {
  forwardByHorizon: ForwardStatsByHorizon;
  minSamples: number;
  minStability: number;
  policy: HorizonPolicy;
  fixed: number;
}

export function pickHorizon(params: HorizonSelectorParams): number {
  const { forwardByHorizon, minSamples, minStability, policy, fixed } = params;

  if (policy === 'FIXED') return fixed;

  const horizons = Object.keys(forwardByHorizon).map(x => Number(x));

  const candidates = horizons
    .map(h => forwardByHorizon[h])
    .filter(s => Number(s?.n ?? 0) >= minSamples)
    .filter(s => Number(s?.stability ?? 0) >= minStability);

  if (!candidates.length) return fixed;

  if (policy === 'STABILITY') {
    candidates.sort((a, b) => Number(b.stability ?? 0) - Number(a.stability ?? 0));
    return Number(candidates[0].horizon);
  }

  // BEST_SHARPE: sort by mean return
  candidates.sort((a, b) => Number(b.mean ?? 0) - Number(a.mean ?? 0));
  return Number(candidates[0].horizon);
}

export function computeStabilityForHorizon(outcomes: number[]): number {
  if (!outcomes.length) return 0;
  
  const sorted = [...outcomes].sort((a, b) => a - b);
  const n = sorted.length;
  
  const p10 = sorted[Math.floor(n * 0.1)] ?? 0;
  const p90 = sorted[Math.floor(n * 0.9)] ?? 0;
  const spread = Math.abs(p90 - p10);
  
  // Stability: tighter distribution + more samples = more stable
  return n > 0 ? (1 / (1 + spread)) * Math.min(1, n / 150) : 0;
}
