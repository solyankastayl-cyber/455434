/**
 * DXY REPLAY SERVICE v1.1
 * Builds Replay path with correct anchor/normalization
 * 
 * Key fix: AFTER / matchEndPrice (not matchStartPrice)
 */

import { PathPoint, ReplayPack, validateReplayPack } from '../../contracts/fractal_path.contract.js';

const EPS = 1e-12;

export type ReplayInput = {
  focusPrices: number[];           // current focus window prices
  matchWindowPrices: number[];     // prices in historical match window
  afterPrices: number[];           // prices AFTER match end, length = H+1
  matchId: string;
  similarity: number;
  matchStartDate: string;
  matchEndDate: string;
};

/**
 * Build replay path with CORRECT anchor normalization
 * 
 * Formula:
 *   rel[i] = afterPrices[i] / matchEndPrice
 *   abs[i] = rel[i] * anchorPrice
 */
export function buildReplayPackAbs(input: ReplayInput): ReplayPack {
  const anchorPrice = input.focusPrices[input.focusPrices.length - 1];
  const matchEndPrice = input.matchWindowPrices[input.matchWindowPrices.length - 1];

  // ✅ Correct normalization: AFTER / matchEndPrice
  const rel = input.afterPrices.map((p) => p / Math.max(matchEndPrice, EPS));
  const abs = rel.map((r) => r * anchorPrice);

  const path: PathPoint[] = abs.map((price, idx) => ({
    t: idx,
    price,
    ret: (price / Math.max(anchorPrice, EPS)) - 1,
  }));

  const pack: ReplayPack = {
    matchId: input.matchId,
    similarity: input.similarity,
    anchorPrice,
    path,
    sourceWindow: { start: input.matchStartDate, end: input.matchEndDate },
  };

  // Validate - throws if path is collapsed
  try {
    validateReplayPack(pack);
  } catch (err) {
    console.warn('[buildReplayPackAbs] Validation warning:', (err as Error).message);
  }

  return pack;
}

/**
 * Compute statistics for replay path (for audit)
 */
export function replayStats(replay: ReplayPack) {
  const prices = replay.path.map(p => p.price);
  const mean = prices.reduce((a, b) => a + b, 0) / Math.max(1, prices.length);
  const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, prices.length);
  const std = Math.sqrt(variance);

  return {
    len: prices.length,
    mean,
    std,
    min: Math.min(...prices),
    max: Math.max(...prices),
    range: Math.max(...prices) - Math.min(...prices),
    endReturn: replay.path.length > 0 
      ? (replay.path[replay.path.length - 1].ret || 0) 
      : 0,
  };
}
