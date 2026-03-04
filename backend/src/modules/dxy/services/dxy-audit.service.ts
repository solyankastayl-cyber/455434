/**
 * DXY CORE AUDIT SERVICE — A1
 * 
 * Diagnostic endpoint for DXY Fractal Core quality assessment.
 * READ-ONLY: Does NOT write to DB, does NOT modify core logic.
 * 
 * Provides:
 * - Similarity distribution (mean/median/percentiles)
 * - Window variance score
 * - Decade coverage
 * - Horizon stability
 * - Entropy metrics
 * - Diagnostic warnings
 */

import { DxyCandleModel } from '../../dxy/storage/dxy-candles.model.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface AuditMatch {
  index: number;
  date: string;
  similarity: number;
  decade: string;
}

interface AuditResult {
  meta: {
    asset: string;
    focus: string;
    windowSize: number;
    topK: number;
    totalCandles: number;
    scanCandidates: number;
    currentWindowVariance: number;
    windowVarianceScore: number;
    timestamp: string;
  };
  similarityDistribution: {
    mean: number;
    median: number;
    std: number;
    min: number;
    max: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  };
  topMatches: Array<{
    rank: number;
    date: string;
    similarity: number;
    decade: string;
  }>;
  decadeCoverage: Record<string, number>;
  topKDecadeSpread: Record<string, number>;
  horizonStability: {
    '7d_vs_30d_overlap': number;
    '30d_vs_90d_overlap': number;
    '90d_vs_365d_overlap': number;
  };
  entropy: {
    topKEntropy: number;
    distributionEntropy: number;
  };
  diagnostics: {
    lowVarianceWarning: boolean;
    similarityClusterWarning: boolean;
    insufficientDecadeSpread: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const FOCUS_TO_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};

const DEFAULT_WINDOW_SIZE = 120;
const DEFAULT_TOP_K = 5;

// ═══════════════════════════════════════════════════════════════
// HELPER: Normalize window to [0, 1] range
// ═══════════════════════════════════════════════════════════════

function normalizeWindow(closes: number[]): number[] {
  if (closes.length === 0) return [];
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min;
  if (range === 0) return closes.map(() => 0.5);
  return closes.map(v => (v - min) / range);
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute similarity (correlation-based)
// ═══════════════════════════════════════════════════════════════

function computeSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  
  const den = Math.sqrt(denA * denB);
  if (den === 0) return 0;
  
  // Convert correlation [-1, 1] to similarity [0, 1]
  const corr = num / den;
  return (corr + 1) / 2;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute variance
// ═══════════════════════════════════════════════════════════════

function variance(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  return arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Statistics
// ═══════════════════════════════════════════════════════════════

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  const v = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

function median(arr: number[]): number {
  return percentile(arr, 0.5);
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Get decade from date
// ═══════════════════════════════════════════════════════════════

function getDecade(dateStr: string): string {
  const year = new Date(dateStr).getFullYear();
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Shannon entropy
// ═══════════════════════════════════════════════════════════════

function shannonEntropy(probabilities: number[]): number {
  return -probabilities
    .filter(p => p > 0)
    .reduce((sum, p) => sum + p * Math.log2(p), 0);
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Scan for matches
// ═══════════════════════════════════════════════════════════════

async function scanMatches(
  candles: Array<{ date: string; close: number }>,
  windowSize: number,
  focusDays: number
): Promise<AuditMatch[]> {
  const n = candles.length;
  // Minimum gap from END of current window = max(focusDays * 2, 120) 
  // This ensures candidate windows don't overlap with current window
  const minGapFromCurrent = Math.max(focusDays * 2, 120);
  
  if (n < windowSize + focusDays + minGapFromCurrent) {
    return [];
  }
  
  // Current window = last windowSize candles
  const currentCloses = candles.slice(-windowSize).map(c => c.close);
  const currentNorm = normalizeWindow(currentCloses);
  
  // First index of current window
  const currentStartIdx = n - windowSize;
  
  const matches: AuditMatch[] = [];
  
  // Scan all candidates where END of candidate window is at least minGapFromCurrent
  // before START of current window
  // candidateEnd = i + windowSize - 1
  // Condition: (i + windowSize - 1) < (currentStartIdx - minGapFromCurrent)
  // => i < currentStartIdx - minGapFromCurrent - windowSize + 1
  const maxIdx = currentStartIdx - minGapFromCurrent - windowSize + 1;
  
  for (let i = 0; i < maxIdx; i++) {
    const candidateCloses = candles.slice(i, i + windowSize).map(c => c.close);
    const candidateNorm = normalizeWindow(candidateCloses);
    
    const similarity = computeSimilarity(currentNorm, candidateNorm);
    
    matches.push({
      index: i,
      date: candles[i + windowSize - 1].date, // End date of window
      similarity,
      decade: getDecade(candles[i + windowSize - 1].date),
    });
  }
  
  return matches;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute window variance score
// ═══════════════════════════════════════════════════════════════

function computeWindowVarianceScore(
  candles: Array<{ close: number }>,
  windowSize: number
): { currentVar: number; score: number } {
  const n = candles.length;
  if (n < windowSize) {
    return { currentVar: 0, score: 0 };
  }
  
  // Current window variance
  const currentCloses = candles.slice(-windowSize).map(c => c.close);
  const currentNorm = normalizeWindow(currentCloses);
  const currentVar = variance(currentNorm);
  
  // Sample all window variances (every 10th window for speed)
  const allVars: number[] = [];
  for (let i = 0; i < n - windowSize; i += 10) {
    const closes = candles.slice(i, i + windowSize).map(c => c.close);
    const norm = normalizeWindow(closes);
    allVars.push(variance(norm));
  }
  
  const medianVar = median(allVars);
  const score = medianVar > 0 ? Math.min(1, currentVar / medianVar) : 0;
  
  return { currentVar, score };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Get topK indices for horizon stability
// ═══════════════════════════════════════════════════════════════

async function getTopKIndices(
  candles: Array<{ date: string; close: number }>,
  windowSize: number,
  focusDays: number,
  topK: number
): Promise<number[]> {
  const matches = await scanMatches(candles, windowSize, focusDays);
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, topK).map(m => m.index);
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Compute overlap between two sets
// ═══════════════════════════════════════════════════════════════

function computeOverlap(a: number[], b: number[]): number {
  const setA = new Set(a);
  const intersection = b.filter(x => setA.has(x)).length;
  return intersection / Math.max(a.length, 1);
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Run Audit
// ═══════════════════════════════════════════════════════════════

export async function runDxyAudit(
  focus: string = '30d',
  windowSize: number = DEFAULT_WINDOW_SIZE,
  topK: number = DEFAULT_TOP_K
): Promise<AuditResult> {
  const focusDays = FOCUS_TO_DAYS[focus] || 30;
  
  // Load all candles
  const candles = await DxyCandleModel
    .find()
    .sort({ date: 1 })
    .select({ date: 1, close: 1, _id: 0 })
    .lean();
  
  if (candles.length < windowSize + focusDays + 100) {
    throw new Error(`Insufficient candles: ${candles.length}`);
  }
  
  console.log(`[DXY Audit] Starting audit: focus=${focus}, window=${windowSize}, topK=${topK}`);
  console.log(`[DXY Audit] Total candles: ${candles.length}`);
  
  // 1. Scan for matches
  const matches = await scanMatches(candles, windowSize, focusDays);
  console.log(`[DXY Audit] Scan candidates: ${matches.length}`);
  
  // 2. Similarity distribution
  const similarities = matches.map(m => m.similarity);
  const similarityDistribution = {
    mean: Math.round(mean(similarities) * 10000) / 10000,
    median: Math.round(median(similarities) * 10000) / 10000,
    std: Math.round(std(similarities) * 10000) / 10000,
    min: Math.round(Math.min(...similarities) * 10000) / 10000,
    max: Math.round(Math.max(...similarities) * 10000) / 10000,
    p10: Math.round(percentile(similarities, 0.10) * 10000) / 10000,
    p25: Math.round(percentile(similarities, 0.25) * 10000) / 10000,
    p50: Math.round(percentile(similarities, 0.50) * 10000) / 10000,
    p75: Math.round(percentile(similarities, 0.75) * 10000) / 10000,
    p90: Math.round(percentile(similarities, 0.90) * 10000) / 10000,
    p95: Math.round(percentile(similarities, 0.95) * 10000) / 10000,
    p99: Math.round(percentile(similarities, 0.99) * 10000) / 10000,
  };
  
  // 3. Window variance score
  const { currentVar, score: windowVarianceScore } = computeWindowVarianceScore(
    candles as Array<{ close: number }>,
    windowSize
  );
  
  // 4. Top matches
  const sortedMatches = [...matches].sort((a, b) => b.similarity - a.similarity);
  const topMatches = sortedMatches.slice(0, topK).map((m, i) => ({
    rank: i + 1,
    date: m.date,
    similarity: Math.round(m.similarity * 10000) / 10000,
    decade: m.decade,
  }));
  
  // 5. Decade coverage
  const decadeCoverage: Record<string, number> = {};
  for (const m of matches) {
    decadeCoverage[m.decade] = (decadeCoverage[m.decade] || 0) + 1;
  }
  
  // 6. TopK decade spread
  const topKDecadeSpread: Record<string, number> = {};
  for (const m of topMatches) {
    topKDecadeSpread[m.decade] = (topKDecadeSpread[m.decade] || 0) + 1;
  }
  
  // 7. Horizon stability
  console.log('[DXY Audit] Computing horizon stability...');
  const top7d = await getTopKIndices(candles as any, windowSize, 7, topK);
  const top30d = await getTopKIndices(candles as any, windowSize, 30, topK);
  const top90d = await getTopKIndices(candles as any, windowSize, 90, topK);
  const top365d = await getTopKIndices(candles as any, windowSize, 365, topK);
  
  const horizonStability = {
    '7d_vs_30d_overlap': Math.round(computeOverlap(top7d, top30d) * 100) / 100,
    '30d_vs_90d_overlap': Math.round(computeOverlap(top30d, top90d) * 100) / 100,
    '90d_vs_365d_overlap': Math.round(computeOverlap(top90d, top365d) * 100) / 100,
  };
  
  // 8. Entropy
  // TopK entropy
  const topKSimilarities = topMatches.map(m => m.similarity);
  const topKSum = topKSimilarities.reduce((a, b) => a + b, 0);
  const topKProbs = topKSimilarities.map(s => s / topKSum);
  const topKEntropy = shannonEntropy(topKProbs);
  
  // Distribution entropy (histogram with 20 bins)
  const binCount = 20;
  const bins = new Array(binCount).fill(0);
  for (const s of similarities) {
    const binIdx = Math.min(Math.floor(s * binCount), binCount - 1);
    bins[binIdx]++;
  }
  const total = similarities.length;
  const binProbs = bins.map(c => c / total);
  const distributionEntropy = shannonEntropy(binProbs);
  
  // 9. Diagnostics
  const diagnostics = {
    lowVarianceWarning: windowVarianceScore < 0.3,
    similarityClusterWarning: similarityDistribution.std < 0.15,
    insufficientDecadeSpread: Object.keys(topKDecadeSpread).length < 2,
  };
  
  console.log('[DXY Audit] Audit complete');
  
  return {
    meta: {
      asset: 'DXY',
      focus,
      windowSize,
      topK,
      totalCandles: candles.length,
      scanCandidates: matches.length,
      currentWindowVariance: Math.round(currentVar * 10000) / 10000,
      windowVarianceScore: Math.round(windowVarianceScore * 100) / 100,
      timestamp: new Date().toISOString(),
    },
    similarityDistribution,
    topMatches,
    decadeCoverage,
    topKDecadeSpread,
    horizonStability,
    entropy: {
      topKEntropy: Math.round(topKEntropy * 10000) / 10000,
      distributionEntropy: Math.round(distributionEntropy * 10000) / 10000,
    },
    diagnostics,
  };
}
