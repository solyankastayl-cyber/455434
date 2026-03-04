/**
 * DXY SYNTHETIC SERVICE — A3 + A3.8
 * 
 * Builds synthetic trajectory, percentile bands, and hybrid path.
 * Compatible with BTC/SPX format.
 * 
 * Core features:
 * - Synthetic path from topK matches (p50 median)
 * - Bands: p10/p50/p90 percentiles
 * - Hybrid: point-by-point blend of synthetic + replay
 * 
 * A3.8: Added mode, tradingEnabled, configUsed, warnings
 */

import { DxyCandleModel } from '../storage/dxy-candles.model.js';
import {
  PathPoint,
  MatchInfo,
  FOCUS_TO_DAYS,
  DEFAULT_WINDOW_LEN,
} from '../contracts/dxy.replay.contract.js';
import {
  toPctFromFirst,
  toPctFromLast,
  mapPctToPrice,
  decadeFromISO,
  normalizeToRange,
  computeSimilarity,
} from '../utils/normalize.js';
import {
  resolveDxyConfig,
  getDxyMode,
  isDxyTradingEnabled,
  getDxyWarnings,
  type DxyFocus,
  type DxyMode,
  type DxyCoreConfig,
} from '../config/dxy.defaults.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface DxySyntheticPack {
  ok: boolean;
  asset: 'DXY';
  focus: string;
  windowLen: number;
  focusLen: number;

  // Percentile distributions (decimal returns: 0.024 = +2.4%)
  pct: {
    p10: number[];
    p50: number[];
    p90: number[];
    mean: number[];
  };

  // Price-space bands as PathPoint[]
  bands: {
    p10: PathPoint[];
    p50: PathPoint[];
    p90: PathPoint[];
  };

  // Synthetic trajectory (= p50)
  synthetic: PathPoint[];

  // Hybrid trajectory (blend of synthetic + replay)
  hybrid: PathPoint[];

  // Weights and diagnostics
  weights: {
    similarity: number;     // 0..1, from rank=1 match
    entropy: number;        // 0..1, distribution spread
    replayWeight: number;   // 0..0.5, clamped weight for replay
    topK: number;
    rank: number;
  };

  // Metadata (A3.8 enhanced)
  meta: {
    currentLastPrice: number;
    currentWindowEnd: string;
    nowTs: number;
    // A3.8 additions
    mode: DxyMode;
    tradingEnabled: boolean;
    configUsed: DxyCoreConfig;
    warnings: string[];
  };

  processingTimeMs: number;
}

interface MatchWithAftermath {
  rank: number;
  similarity: number;
  aftermathNormalized: number[];
  startDate: string;
  endDate: string;
}

// ═══════════════════════════════════════════════════════════════
// MATH HELPERS
// ═══════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  let sumSq = 0;
  for (const v of arr) sumSq += (v - m) ** 2;
  return Math.sqrt(sumSq / arr.length);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

function computeEntropy(similarities: number[]): number {
  // Entropy = normalized std dev of similarities
  // Higher entropy = more spread = less certainty
  if (similarities.length < 2) return 0.25;
  const std = stdDev(similarities);
  const avg = mean(similarities);
  // Normalize: if std/avg is high, entropy is high
  // Clamp to 0..1
  return Math.min(1, Math.max(0, std / Math.max(avg, 0.01)));
}

function computeHybridWeight(similarity: number, entropy: number): number {
  // w = similarity * (1 - entropy)
  // Replay should not dominate, clamp to 0..0.5
  const w = similarity * (1 - entropy);
  return Math.min(0.5, Math.max(0, w));
}

// ═══════════════════════════════════════════════════════════════
// BUILD FORWARD TIMESTAMPS
// ═══════════════════════════════════════════════════════════════

function buildForwardDates(startDate: string, n: number): string[] {
  const dates: string[] = [];
  const d = new Date(startDate);
  for (let i = 1; i <= n; i++) {
    d.setDate(d.getDate() + 1);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

// ═══════════════════════════════════════════════════════════════
// CONVERT PCT TO PATHPOINTS
// CRITICAL: Prepend t=0 with pct=0 (anchor at NOW/currentPrice)
// ═══════════════════════════════════════════════════════════════

function toPathPoints(
  basePrice: number,
  pctSeries: number[],
  startDate: string
): PathPoint[] {
  // Rebase pctSeries so first value = 0
  const offset = pctSeries[0] || 0;
  const rebasedPct = pctSeries.map(p => p - offset);
  
  const dates = buildForwardDates(startDate, rebasedPct.length);
  return rebasedPct.map((pct, i) => ({
    t: i,
    date: dates[i],
    price: Math.round(mapPctToPrice(basePrice, pct) * 10000) / 10000,
    pctFromStart: Math.round(pct * 10000) / 10000,
  }));
}

// ═══════════════════════════════════════════════════════════════
// SCAN FOR TOP MATCHES WITH AFTERMATH
// ═══════════════════════════════════════════════════════════════

async function scanTopMatchesWithAftermath(
  candles: Array<{ date: string; close: number }>,
  windowLen: number,
  focusLen: number,
  topK: number = 10
): Promise<MatchWithAftermath[]> {
  const n = candles.length;
  
  // CRITICAL: minGap must ensure full aftermath data available
  const minGap = Math.max(focusLen + windowLen, focusLen * 3, 250);

  if (n < windowLen + focusLen + minGap) {
    throw new Error('Insufficient candles for synthetic scan');
  }

  // Current window (last windowLen candles)
  const currentCloses = candles.slice(-windowLen).map(c => c.close);
  const currentNorm = normalizeToRange(currentCloses);

  const currentStartIdx = n - windowLen;
  const maxIdx = currentStartIdx - minGap;

  const matches: Array<{
    startIndex: number;
    similarity: number;
    startDate: string;
    endDate: string;
  }> = [];

  for (let i = 0; i < maxIdx; i++) {
    // Ensure full aftermath data exists
    if (i + windowLen + focusLen > currentStartIdx - minGap) continue;
    
    const candidateCloses = candles.slice(i, i + windowLen).map(c => c.close);
    const candidateNorm = normalizeToRange(candidateCloses);
    const similarity = computeSimilarity(currentNorm, candidateNorm);

    matches.push({
      startIndex: i,
      similarity,
      startDate: candles[i].date,
      endDate: candles[i + windowLen - 1].date,
    });
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);

  // Take topK and build aftermath for each
  return matches.slice(0, topK).map((m, idx) => {
    const histWindowPrices = candles.slice(m.startIndex, m.startIndex + windowLen).map(c => c.close);
    const histAfterPrices = candles.slice(m.startIndex + windowLen, m.startIndex + windowLen + focusLen).map(c => c.close);
    const aftermathNormalized = toPctFromLast(histWindowPrices, histAfterPrices);

    return {
      rank: idx + 1,
      similarity: m.similarity,
      aftermathNormalized,
      startDate: m.startDate,
      endDate: m.endDate,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// BUILD SYNTHETIC PACK — MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════

export async function buildDxySyntheticPack(
  focus: string = '30d',
  topK: number = 5,
  rank: number = 1,
  windowLen: number = DEFAULT_WINDOW_LEN
): Promise<DxySyntheticPack> {
  const start = Date.now();
  const focusLen = FOCUS_TO_DAYS[focus] || 30;

  // Load all candles sorted ascending
  const candles = await DxyCandleModel
    .find()
    .sort({ date: 1 })
    .select({ date: 1, close: 1, _id: 0 })
    .lean() as Array<{ date: string; close: number }>;

  const n = candles.length;

  if (n < windowLen + focusLen + 120) {
    throw new Error(`Insufficient candles: ${n}`);
  }

  // Get topK matches with aftermath
  const matches = await scanTopMatchesWithAftermath(candles, windowLen, focusLen, Math.max(topK, 10));

  if (matches.length === 0) {
    throw new Error('No matches found for synthetic');
  }

  // Current window info
  const currentWindowCandles = candles.slice(-windowLen);
  const currentCloses = currentWindowCandles.map(c => c.close);
  const currentLastPrice = currentCloses[windowLen - 1];
  const currentWindowEnd = currentWindowCandles[windowLen - 1].date;

  // ═══════════════════════════════════════════════════════════════
  // 1) BUILD PERCENTILE DISTRIBUTIONS
  // ═══════════════════════════════════════════════════════════════

  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];
  const meanPct: number[] = [];

  const usedMatches = matches.slice(0, topK);

  for (let t = 0; t < focusLen; t++) {
    const values: number[] = [];

    for (const m of usedMatches) {
      const v = m.aftermathNormalized?.[t];
      if (Number.isFinite(v)) {
        values.push(v);
      }
    }

    // Sort for percentile calculation
    values.sort((a, b) => a - b);

    // Fallback if no data at this t
    if (values.length === 0) {
      values.push(0);
    }

    p10.push(percentile(values, 0.10));
    p50.push(percentile(values, 0.50));
    p90.push(percentile(values, 0.90));
    meanPct.push(mean(values));
  }

  // ═══════════════════════════════════════════════════════════════
  // 2) VALIDATE BANDS ORDERING
  // ═══════════════════════════════════════════════════════════════

  for (let i = 0; i < focusLen; i++) {
    if (!(p10[i] <= p50[i] && p50[i] <= p90[i])) {
      // This shouldn't happen, but fix if it does
      const sorted = [p10[i], p50[i], p90[i]].sort((a, b) => a - b);
      p10[i] = sorted[0];
      p50[i] = sorted[1];
      p90[i] = sorted[2];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 3) SYNTHETIC = p50 (median trajectory)
  // ═══════════════════════════════════════════════════════════════

  const synthetic = toPathPoints(currentLastPrice, p50, currentWindowEnd);

  // ═══════════════════════════════════════════════════════════════
  // 4) BANDS AS PATHPOINTS
  // ═══════════════════════════════════════════════════════════════

  const bands = {
    p10: toPathPoints(currentLastPrice, p10, currentWindowEnd),
    p50: toPathPoints(currentLastPrice, p50, currentWindowEnd),
    p90: toPathPoints(currentLastPrice, p90, currentWindowEnd),
  };

  // ═══════════════════════════════════════════════════════════════
  // 5) COMPUTE ENTROPY FROM SIMILARITY DISTRIBUTION
  // ═══════════════════════════════════════════════════════════════

  const similarities = usedMatches.map(m => m.similarity);
  const entropy = computeEntropy(similarities);

  // ═══════════════════════════════════════════════════════════════
  // 6) HYBRID = BLEND OF SYNTHETIC + REPLAY (point-by-point)
  // CRITICAL: Both paths must be rebased to start at 0 before blending
  // ═══════════════════════════════════════════════════════════════

  const rankMatch = matches.find(m => m.rank === rank) || matches[0];
  const similarity = rankMatch.similarity;
  const rawReplayPct = rankMatch.aftermathNormalized;
  const replayWeight = computeHybridWeight(similarity, entropy);

  // Rebase both arrays to start at 0 BEFORE blending
  const synOffset = p50[0] || 0;
  const repOffset = rawReplayPct[0] || 0;
  
  const rebasedSynPct = p50.map(v => v - synOffset);
  const rebasedRepPct = rawReplayPct.map(v => v - repOffset);

  const hybridPct: number[] = [];
  for (let t = 0; t < focusLen; t++) {
    const synVal = rebasedSynPct[t] ?? 0;
    const repVal = rebasedRepPct[t] ?? 0;
    const h = (1 - replayWeight) * synVal + replayWeight * repVal;
    hybridPct.push(h);
  }

  // hybridPct is already rebased (starts at 0)
  const hybrid = toPathPoints(currentLastPrice, hybridPct, currentWindowEnd);

  // ═══════════════════════════════════════════════════════════════
  // 7) A3.8: Resolve config and mode for this focus
  // ═══════════════════════════════════════════════════════════════
  
  const config = resolveDxyConfig(focus as DxyFocus);
  const mode = getDxyMode(focus as DxyFocus);
  const tradingEnabled = isDxyTradingEnabled(focus as DxyFocus);
  const warnings = getDxyWarnings(focus as DxyFocus);

  // ═══════════════════════════════════════════════════════════════
  // 8) REBASE PCT ARRAYS TO START AT 0
  // ═══════════════════════════════════════════════════════════════
  
  // Rebase all pct arrays so they start at 0 (anchor at NOW)
  const rebaseArray = (arr: number[]): number[] => {
    const offset = arr[0] || 0;
    return arr.map(v => Math.round((v - offset) * 10000) / 10000);
  };
  
  const rebasedP10 = rebaseArray(p10);
  const rebasedP50 = rebaseArray(p50);
  const rebasedP90 = rebaseArray(p90);
  const rebasedMean = rebaseArray(meanPct);
  
  // ═══════════════════════════════════════════════════════════════
  // 9) BUILD FINAL PACK
  // ═══════════════════════════════════════════════════════════════

  return {
    ok: true,
    asset: 'DXY',
    focus,
    windowLen,
    focusLen,
    pct: {
      p10: rebasedP10,
      p50: rebasedP50,
      p90: rebasedP90,
      mean: rebasedMean,
    },
    bands,
    synthetic,
    hybrid,
    weights: {
      similarity: Math.round(similarity * 10000) / 10000,
      entropy: Math.round(entropy * 10000) / 10000,
      replayWeight: Math.round(replayWeight * 10000) / 10000,
      topK,
      rank,
    },
    meta: {
      currentLastPrice: Math.round(currentLastPrice * 10000) / 10000,
      currentWindowEnd,
      nowTs: Date.now(),
      // A3.8 additions
      mode,
      tradingEnabled,
      configUsed: config,
      warnings,
    },
    processingTimeMs: Date.now() - start,
  };
}
