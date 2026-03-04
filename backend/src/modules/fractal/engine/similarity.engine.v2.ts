/**
 * BLOCK 37.1 — Multi-Representation Similarity Engine V2
 * 
 * Core pattern matching through ensemble representations:
 * - ret: raw log returns
 * - vol: volatility shape (rolling std)
 * - dd: drawdown path signature
 * - momo: momentum slope (optional)
 * 
 * Similarity = weighted sum of cosine similarities per representation
 */

import {
  RepKey,
  MultiRepConfig,
  WindowRepVectors,
  MultiRepScore,
  DEFAULT_MULTI_REP_CONFIG,
} from '../contracts/similarity.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Math Utilities
// ═══════════════════════════════════════════════════════════════

function mean(a: number[]): number {
  if (a.length === 0) return 0;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  const variance = a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
  return Math.sqrt(variance);
}

function l2norm(a: number[]): number {
  return Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function zscore(x: number[]): number[] {
  const m = mean(x);
  const sd = stdev(x) || 1;
  return x.map(v => (v - m) / sd);
}

function l2normalize(x: number[]): number[] {
  const n = l2norm(x);
  return x.map(v => v / n);
}

function safeSlice<T>(arr: T[], from: number, to: number): T[] {
  const f = Math.max(0, from);
  const t = Math.min(arr.length, to);
  return arr.slice(f, t);
}

// ═══════════════════════════════════════════════════════════════
// Vector Builders
// ═══════════════════════════════════════════════════════════════

/**
 * Build log returns from closes
 * Input: closes[t-windowLen .. t] inclusive (length = windowLen+1)
 * Output: returns of length windowLen
 */
export function buildRawReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev > 0 && cur > 0) {
      r.push(Math.log(cur / prev));
    } else {
      r.push(0);
    }
  }
  return r;
}

/**
 * Volatility shape: rolling stdev of returns, then normalize shape
 * Captures volatility profile within the window
 */
export function buildVolShape(returns: number[], lookback = 14): number[] {
  const out: number[] = [];
  for (let i = 0; i < returns.length; i++) {
    const window = safeSlice(returns, i - lookback + 1, i + 1);
    const sd = stdev(window);
    out.push(sd);
  }
  return out;
}

/**
 * Drawdown shape: drawdown series from equity curve of returns
 * Captures path signature of drawdowns within the window
 */
export function buildDrawdownShape(returns: number[]): number[] {
  let eq = 1.0;
  let peak = 1.0;
  const dd: number[] = [];
  
  for (let i = 0; i < returns.length; i++) {
    eq *= Math.exp(returns[i]);
    if (eq > peak) peak = eq;
    const drawdown = (eq / peak) - 1; // negative or 0
    dd.push(drawdown);
  }
  return dd;
}

/**
 * Momentum slope: linear trend proxy on cumulative returns over last N
 * Captures trend acceleration within the window
 */
export function buildMomentumSlope(returns: number[], lookback = 10): number[] {
  const out: number[] = [];
  let cum = 0;
  const cumSeries: number[] = [];
  
  for (const r of returns) {
    cum += r;
    cumSeries.push(cum);
  }

  for (let i = 0; i < cumSeries.length; i++) {
    const window = safeSlice(cumSeries, i - lookback + 1, i + 1);
    // simple slope: (last-first)/len
    const slope = window.length >= 2 
      ? (window[window.length - 1] - window[0]) / (window.length - 1) 
      : 0;
    out.push(slope);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// Multi-Rep Vector Builder
// ═══════════════════════════════════════════════════════════════

/**
 * Build all representation vectors for a window of closes
 * @param closes - array of close prices (length = windowLen + 1)
 * @param cfg - multi-rep configuration
 */
export function buildMultiRepVectors(
  closes: number[],
  cfg: MultiRepConfig = DEFAULT_MULTI_REP_CONFIG
): WindowRepVectors[] {
  const returns = buildRawReturns(closes);
  const reps = cfg.reps?.length ? cfg.reps : (["ret", "vol", "dd"] as RepKey[]);
  const out: WindowRepVectors[] = [];

  for (const rep of reps) {
    let vec: number[] = [];
    
    switch (rep) {
      case "ret":
        vec = returns;
        break;
      case "vol":
        vec = buildVolShape(returns, cfg.volLookback ?? 14);
        break;
      case "dd":
        vec = buildDrawdownShape(returns);
        break;
      case "momo":
        vec = buildMomentumSlope(returns, cfg.slopeLookback ?? 10);
        break;
    }

    // Apply normalization
    if (cfg.zscoreWithinWindow) {
      vec = zscore(vec);
    }
    if (cfg.l2Normalize ?? true) {
      vec = l2normalize(vec);
    }

    out.push({ rep, vec });
  }
  
  return out;
}

// ═══════════════════════════════════════════════════════════════
// Similarity Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Cosine similarity between two vectors
 */
export function cosineSim(a: number[], b: number[]): number {
  const denom = (l2norm(a) * l2norm(b)) || 1;
  return dot(a, b) / denom;
}

/**
 * Default weight for each representation
 */
function defaultRepWeight(r: RepKey): number {
  switch (r) {
    case "ret": return 0.45;
    case "vol": return 0.30;
    case "dd": return 0.20;
    case "momo": return 0.05;
    default: return 0.25;
  }
}

/**
 * Compute multi-representation similarity between two windows
 * @param a - current window vectors
 * @param b - historical window vectors
 * @param cfg - multi-rep configuration
 */
export function multiRepSimilarity(
  a: WindowRepVectors[],
  b: WindowRepVectors[],
  cfg: MultiRepConfig = DEFAULT_MULTI_REP_CONFIG
): MultiRepScore {
  const weightsIn = cfg.repWeights ?? {};
  const reps = a.map(x => x.rep);
  
  // Normalize weights across active reps
  let sumW = 0;
  const w: Partial<Record<RepKey, number>> = {};
  for (const r of reps) {
    const ww = weightsIn[r] ?? defaultRepWeight(r);
    w[r] = ww;
    sumW += ww;
  }
  sumW = sumW || 1;

  let total = 0;
  const byRep: Partial<Record<RepKey, number>> = {};
  const wNorm: Partial<Record<RepKey, number>> = {};

  for (const r of reps) {
    const av = a.find(x => x.rep === r)?.vec;
    const bv = b.find(x => x.rep === r)?.vec;
    if (!av || !bv) continue;
    
    const sim = cosineSim(av, bv);
    const wn = (w[r] ?? 0) / sumW;
    
    byRep[r] = sim;
    wNorm[r] = wn;
    total += wn * sim;
  }

  return { total, byRep, weights: wNorm };
}

// ═══════════════════════════════════════════════════════════════
// Single-mode fallback (legacy compatibility)
// ═══════════════════════════════════════════════════════════════

/**
 * Build single-rep vector (for stage-1 fast retrieval)
 */
export function buildSingleRepVector(closes: number[], normalize = true): number[] {
  const returns = buildRawReturns(closes);
  return normalize ? l2normalize(returns) : returns;
}
