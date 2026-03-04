/**
 * Fractal Similarity Engine
 * Core pattern matching logic with optimized calculations
 * 
 * BLOCK 34.10: Added SimilarityMode for asOf-safe simulations
 */

import { FractalWindow, FractalMatch, ForwardOutcome } from '../contracts/fractal.contracts.js';
import { MIN_GAP_DAYS, ONE_DAY_MS } from '../domain/constants.js';

const EPS = 1e-12;

// BLOCK 34.10: Similarity mode type
export type SimilarityMode = "zscore" | "raw_returns";

/**
 * L2 normalize a vector (unit length)
 */
function l2Normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map(x => x / n);
}

/**
 * Build log returns from closes
 */
function logReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
      r.push(0);
    } else {
      r.push(Math.log(b / a));
    }
  }
  return r;
}

/**
 * BLOCK 34.10: Build window vector with mode selection
 * 
 * raw_returns: asOf-safe, only L2 normalize (no distribution dependence)
 * zscore: z-score within window + L2 normalize
 * 
 * CRITICAL: Both hist and cur vectors MUST use the same mode for valid comparison
 */
export function buildWindowVector(
  closes: number[],
  mode: SimilarityMode
): number[] {
  const r = logReturns(closes);

  if (mode === "raw_returns") {
    // asOf-safe: only L2 normalize, no zscore
    return l2Normalize(r);
  }

  // zscore mode: z-score within window + L2 normalize
  const n = r.length;
  if (n === 0) return r;

  let sum = 0;
  for (const x of r) sum += x;
  const mean = sum / n;

  let varSum = 0;
  for (const x of r) {
    const d = x - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / Math.max(1, n - 1)) || 1;

  const z = r.map(x => (x - mean) / std);
  return l2Normalize(z);
}

export class SimilarityEngine {
  /**
   * Build log returns from close prices
   */
  buildLogReturns(closes: number[]): number[] {
    const r: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const prev = closes[i - 1];
      const cur = closes[i];
      r.push(Math.log(cur / prev));
    }
    return r;
  }

  /**
   * Z-score normalization (legacy, kept for compatibility)
   */
  zScoreNormalize(values: number[]): number[] {
    const n = values.length;
    if (n === 0) return values;

    let sum = 0;
    for (const x of values) sum += x;
    const mean = sum / n;

    let varSum = 0;
    for (const x of values) {
      const d = x - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / Math.max(1, n - 1)) || 1;

    return values.map(x => (x - mean) / std);
  }

  /**
   * Cosine similarity between two vectors
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dot / (denominator + EPS);
  }

  /**
   * Fast cosine with pre-computed norms
   */
  cosineWithNorms(a: number[], b: number[], normA: number, normB: number): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot / (normA * normB + EPS);
  }

  /**
   * Build all windows from price data
   */
  buildWindows(
    prices: Array<{ ts: Date; close: number }>,
    windowLen: number
  ): FractalWindow[] {
    const windows: FractalWindow[] = [];

    if (prices.length < windowLen + 1) {
      return windows;
    }

    // Calculate log returns
    const returns: Array<{ ts: Date; ret: number }> = [];
    for (let i = 1; i < prices.length; i++) {
      const ret = Math.log(prices[i].close / prices[i - 1].close);
      returns.push({ ts: prices[i].ts, ret });
    }

    // Build sliding windows
    for (let i = 0; i <= returns.length - windowLen; i++) {
      const windowReturns = returns.slice(i, i + windowLen);
      const values = windowReturns.map(r => r.ret);
      
      // Z-score normalize
      const normalized = this.zScoreNormalize(values);

      windows.push({
        startTs: windowReturns[0].ts,
        endTs: windowReturns[windowLen - 1].ts,
        values: normalized
      });
    }

    return windows;
  }

  /**
   * Find top-K most similar historical windows
   */
  findMatches(
    currentWindow: FractalWindow,
    historicalWindows: FractalWindow[],
    topK: number
  ): FractalMatch[] {
    const currentEndTs = currentWindow.endTs.getTime();
    const minGapMs = MIN_GAP_DAYS * ONE_DAY_MS;

    // Calculate similarity for each historical window
    const scored: Array<{ window: FractalWindow; score: number }> = [];

    for (const histWindow of historicalWindows) {
      // Skip if too close to current window
      const gap = currentEndTs - histWindow.endTs.getTime();
      if (gap < minGapMs) continue;

      // Calculate cosine similarity
      const score = this.cosineSimilarity(
        currentWindow.values,
        histWindow.values
      );

      scored.push({ window: histWindow, score });
    }

    // Sort by similarity (descending)
    scored.sort((a, b) => b.score - a.score);

    // Take top-K
    return scored.slice(0, topK).map((s, idx) => ({
      startTs: s.window.startTs,
      endTs: s.window.endTs,
      score: s.score,
      rank: idx + 1
    }));
  }

  /**
   * Calculate forward outcomes for matches
   */
  calculateForwardOutcomes(
    matches: FractalMatch[],
    prices: Array<{ ts: Date; close: number }>,
    horizonDays: number
  ): ForwardOutcome[] {
    const outcomes: ForwardOutcome[] = [];
    const horizonMs = horizonDays * ONE_DAY_MS;

    // Build price lookup map
    const priceMap = new Map<number, number>();
    for (const p of prices) {
      priceMap.set(p.ts.getTime(), p.close);
    }

    for (const match of matches) {
      const endTs = match.endTs.getTime();
      const endPrice = priceMap.get(endTs);

      if (!endPrice) continue;

      // Find prices in forward horizon
      const forwardPrices: number[] = [];
      for (let day = 1; day <= horizonDays; day++) {
        const ts = endTs + day * ONE_DAY_MS;
        const price = priceMap.get(ts);
        if (price) forwardPrices.push(price);
      }

      if (forwardPrices.length === 0) continue;

      // Calculate return at horizon end
      const finalPrice = forwardPrices[forwardPrices.length - 1];
      const returnPct = (finalPrice - endPrice) / endPrice;

      // Calculate max drawdown
      let maxDrawdown = 0;
      let peak = endPrice;
      for (const price of forwardPrices) {
        if (price > peak) peak = price;
        const drawdown = (peak - price) / peak;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }

      outcomes.push({
        returnPct,
        maxDrawdownPct: -maxDrawdown // Negative for drawdown
      });
    }

    return outcomes;
  }
}
