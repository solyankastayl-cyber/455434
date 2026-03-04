/**
 * DXY HYBRID SERVICE v1.1
 * Point-by-point mixing of Replay + Synthetic
 * 
 * Key fix: Mix at each t, not just endReturn
 */

import { HybridPack, PathPoint, ReplayPack, SyntheticPack, validateHybridPack } from '../../contracts/fractal_path.contract.js';

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

export type HybridInput = {
  replay: ReplayPack;
  synthetic: SyntheticPack;
  similarity: number;       // top match similarity [0..1]
  entropy01: number;        // uncertainty [0..1], high = less replay trust
};

/**
 * Build hybrid path with CORRECT point-by-point mixing
 * 
 * Formula:
 *   wReplay = clamp(similarity * (1 - entropy), 0.15, 0.85)
 *   wSynthetic = 1 - wReplay
 *   hybridPrice[t] = wReplay * replayPrice[t] + wSynthetic * synthMeanPrice[t]
 */
export function buildHybridPackAbs(input: HybridInput): HybridPack {
  const anchorPrice = input.synthetic.anchorPrice;

  // ✅ Weight calculation: similarity × (1 - entropy), clamped
  const raw = input.similarity * (1 - input.entropy01);
  const wReplay = clamp(raw, 0.15, 0.85);
  const wSynthetic = 1 - wReplay;

  const H = Math.min(input.replay.path.length, input.synthetic.meanPath.length);

  const path: PathPoint[] = [];
  for (let i = 0; i < H; i++) {
    const pR = input.replay.path[i]?.price || anchorPrice;
    const pS = input.synthetic.meanPath[i]?.price || anchorPrice;
    
    // ✅ Point-by-point mixing
    const price = wReplay * pR + wSynthetic * pS;
    path.push({
      t: i,
      price,
      ret: price / anchorPrice - 1,
    });
  }

  const pack: HybridPack = {
    anchorPrice,
    path,
    weights: {
      wReplay,
      wSynthetic,
      reason: `wReplay = similarity(${input.similarity.toFixed(2)}) × (1 - entropy(${input.entropy01.toFixed(2)})) = ${raw.toFixed(3)}, clamped to [0.15, 0.85]`,
    },
    breakdown: {
      replayPath: input.replay.path.slice(0, H),
      syntheticMean: input.synthetic.meanPath.slice(0, H),
    },
  };

  // Validate
  try {
    validateHybridPack(pack);
  } catch (err) {
    console.warn('[buildHybridPackAbs] Validation warning:', (err as Error).message);
  }

  return pack;
}

/**
 * Compute distance metrics between paths (for audit)
 */
export function pathDistance(a: PathPoint[], b: PathPoint[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = (a[i]?.price || 0) - (b[i]?.price || 0);
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}
