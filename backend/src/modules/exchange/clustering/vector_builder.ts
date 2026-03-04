/**
 * BLOCK 2.12 — Vector Builder
 * ============================
 * Builds normalized z-score vectors for clustering.
 */

export type StatsPack = {
  means: Record<string, number>;
  stds: Record<string, number>;
};

export type VectorBuildOpts = {
  featureKeys: string[];
  stats: StatsPack;
  missingValue?: number;
  clipZ?: number;
};

export function buildZVector(
  features: Record<string, number | null>,
  opts: VectorBuildOpts
): number[] {
  const mv = opts.missingValue ?? 0;
  const clip = opts.clipZ ?? 4;

  return opts.featureKeys.map((k) => {
    const v = features[k];
    if (v === null || v === undefined || Number.isNaN(v)) return mv;

    const mean = opts.stats.means[k] ?? 0;
    const std = opts.stats.stds[k] ?? 1;
    const z = (v - mean) / (std === 0 ? 1 : std);
    return Math.max(-clip, Math.min(clip, z));
  });
}

export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 1;
  return 1 - (dot / denom);
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

console.log('[Clustering] Vector Builder loaded');
