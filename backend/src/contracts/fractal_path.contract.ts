/**
 * FRACTAL PATH CONTRACT v1.1
 * Unified types for Synthetic/Replay/Hybrid/Macro paths
 */

export type PathPoint = {
  t: number;          // 0..H (horizon index)
  date?: string;      // optional ISO date
  price: number;      // ABSOLUTE price
  ret?: number;       // optional return from anchor
};

export type PathBand = {
  p10: PathPoint[];
  p50: PathPoint[];
  p90: PathPoint[];
};

export type ReplayPack = {
  matchId: string;
  similarity: number;
  anchorPrice: number;
  path: PathPoint[];
  sourceWindow: { start: string; end: string };
};

export type SyntheticPack = {
  k: number;                  // number of matches used
  anchorPrice: number;
  meanPath: PathPoint[];      // p50 alias
  bands: PathBand;
};

export type HybridPack = {
  anchorPrice: number;
  path: PathPoint[];
  weights: {
    wReplay: number;          // 0..1
    wSynthetic: number;       // 0..1 (sum=1)
    reason?: string;
  };
  breakdown: {
    replayPath: PathPoint[];
    syntheticMean: PathPoint[];
  };
};

export type MacroPack = {
  anchorPrice: number;
  path: PathPoint[];
  adjustment: {
    scoreSigned: number;
    confidence: number;
    regime: string;
    kappa: number;
    deltaReturnEnd: number;
  };
};

// Validation helpers
export function validateReplayPack(replay: ReplayPack): void {
  if (replay.path.length < 5) {
    throw new Error('Replay path too short');
  }
  
  const prices = replay.path.map(p => p.price);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length;
  const std = Math.sqrt(variance);
  
  const threshold = replay.anchorPrice * 0.0002;
  if (std < threshold) {
    throw new Error(`Replay path collapsed (std=${std.toFixed(4)} < ${threshold.toFixed(4)}) — check anchor/normalization`);
  }
}

export function validateHybridPack(hybrid: HybridPack): void {
  if (hybrid.weights.wReplay <= 0) {
    throw new Error('Hybrid wReplay must be > 0');
  }
  if (hybrid.weights.wSynthetic <= 0) {
    throw new Error('Hybrid wSynthetic must be > 0');
  }
  if (Math.abs(hybrid.weights.wReplay + hybrid.weights.wSynthetic - 1) > 0.001) {
    throw new Error('Hybrid weights must sum to 1');
  }
}
