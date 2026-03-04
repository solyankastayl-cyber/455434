/**
 * DXY WALK-FORWARD SERVICE — A3.5
 * 
 * ISOLATION: DXY walk-forward validation. No BTC/SPX imports.
 * 
 * Core functionality:
 * - runWalkForward: Generate signals for historical snapshots
 * - resolveWalkOutcomes: Fill in actual returns when data available
 * - recomputeWalkMetrics: Aggregate performance metrics
 * 
 * CRITICAL: All candle queries must use asOf upper bound to prevent future leakage!
 */

import { DxyCandleModel } from '../storage/dxy-candles.model.js';
import { DxyWalkSignalModel } from './models/dxy_walk_signal.model.js';
import { DxyWalkOutcomeModel } from './models/dxy_walk_outcome.model.js';
import { DxyWalkMetricsModel } from './models/dxy_walk_metrics.model.js';
import {
  WALK_CONSTANTS,
  type WalkMode,
  type WalkDirection,
  type WalkRunParams,
  type WalkRunResult,
  type WalkResolveParams,
  type WalkResolveResult,
  type WalkSummaryResult,
  type WeightMode,
} from './dxy-walk.types.js';
import {
  normalizeToRange,
  computeSimilarity,
  toPctFromLast,
} from '../utils/normalize.js';

const {
  WINDOW_LEN_DEFAULT,
  TOPK_DEFAULT,
  STEP_DAYS_DEFAULT,
  THRESHOLD_DEFAULT,
  WEIGHT_CLAMP_MAX_DEFAULT,
  MAX_PROCESSED_PER_REQUEST,
} = WALK_CONSTANTS;

// ═══════════════════════════════════════════════════════════════
// HELPER: Generate date range with step
// ═══════════════════════════════════════════════════════════════

function generateDateRange(from: Date, to: Date, stepDays: number): Date[] {
  const dates: Date[] = [];
  const current = new Date(from);
  
  while (current <= to) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + stepDays);
  }
  
  return dates;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Add calendar days to date
// ═══════════════════════════════════════════════════════════════

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Convert Date to ISO string (YYYY-MM-DD)
// ═══════════════════════════════════════════════════════════════

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Parse ISO date string to Date
// ═══════════════════════════════════════════════════════════════

function parseISODate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Math utilities
// ═══════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  const sumSq = arr.reduce((sum, v) => sum + (v - m) ** 2, 0);
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

// ═══════════════════════════════════════════════════════════════
// CORE: Get candles with asOf upper bound (CRITICAL for A3.5!)
// ═══════════════════════════════════════════════════════════════

async function getCandlesUpTo(asOf: Date): Promise<Array<{ date: string; close: number }>> {
  const candles = await DxyCandleModel
    .find({ date: { $lte: asOf } })
    .sort({ date: 1 })
    .select({ date: 1, close: 1, _id: 0 })
    .lean();
  
  return candles.map(c => ({
    date: c.date instanceof Date ? toISODate(c.date) : String(c.date),
    close: c.close,
  }));
}

// ═══════════════════════════════════════════════════════════════
// CORE: Get single candle by date (or next available)
// ═══════════════════════════════════════════════════════════════

async function getCandleAtOrAfter(targetDate: Date): Promise<{ date: string; close: number } | null> {
  const candle = await DxyCandleModel
    .findOne({ date: { $gte: targetDate } })
    .sort({ date: 1 })
    .select({ date: 1, close: 1, _id: 0 })
    .lean();
  
  if (!candle) return null;
  
  return {
    date: candle.date instanceof Date ? toISODate(candle.date) : String(candle.date),
    close: candle.close,
  };
}

// ═══════════════════════════════════════════════════════════════
// CORE: Scan for top matches (with asOf constraint!)
// ═══════════════════════════════════════════════════════════════

interface MatchWithAftermath {
  rank: number;
  similarity: number;
  aftermathNormalized: number[];
  startDate: string;
  endDate: string;
}

async function scanMatchesWithAsOf(
  candles: Array<{ date: string; close: number }>,
  windowLen: number,
  focusLen: number,
  topK: number
): Promise<MatchWithAftermath[]> {
  const n = candles.length;
  const minGap = Math.max(focusLen * 2, 120);
  
  if (n < windowLen + focusLen + minGap) {
    return [];
  }
  
  // Current window (last windowLen candles)
  const currentCloses = candles.slice(-windowLen).map(c => c.close);
  const currentNorm = normalizeToRange(currentCloses);
  
  const currentStartIdx = n - windowLen;
  const maxIdx = currentStartIdx - minGap - windowLen + 1;
  
  if (maxIdx <= 0) return [];
  
  const matches: Array<{
    startIndex: number;
    similarity: number;
    startDate: string;
    endDate: string;
  }> = [];
  
  for (let i = 0; i < maxIdx; i++) {
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
  
  // Build aftermath for top K
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
// CORE: Compute synthetic/hybrid prediction
// A3.6: Added weightMode support
// ═══════════════════════════════════════════════════════════════

interface PredictionResult {
  syntheticReturn: number;  // p50 median
  hybridReturn: number;
  similarity: number;
  entropy: number;
  replayWeight: number;
  matchDate: string | null;
}

/**
 * A3.6 - Compute replay weight based on mode
 * W0: Baseline: w = similarity * (1 - entropy), clamp to weightClampMax
 * W1: Lower clamp: w = similarity * (1 - entropy), clamp to 0.35
 * W2: Non-linear: w = similarity^2 * (1 - entropy), clamp to weightClampMax
 * W3: Strong entropy: w = similarity * (1 - 1.5*entropy), clamp to weightClampMax
 */
function computeReplayWeight(
  similarity: number,
  entropy: number,
  weightMode: WeightMode,
  weightClampMax: number
): number {
  let wRaw: number;
  let clampMax = weightClampMax;
  
  switch (weightMode) {
    case 'W1':
      // Lower clamp
      wRaw = similarity * (1 - entropy);
      clampMax = 0.35;
      break;
    case 'W2':
      // Non-linear similarity (sim^2)
      wRaw = (similarity * similarity) * (1 - entropy);
      break;
    case 'W3':
      // Strong entropy penalty (1.5x)
      wRaw = similarity * (1 - 1.5 * entropy);
      break;
    case 'W0':
    default:
      // Baseline
      wRaw = similarity * (1 - entropy);
      break;
  }
  
  return Math.min(clampMax, Math.max(0, wRaw));
}

function computePrediction(
  matches: MatchWithAftermath[],
  horizonIndex: number,
  topK: number,
  weightMode: WeightMode = 'W0',
  weightClampMax: number = 0.5
): PredictionResult | null {
  if (matches.length === 0) return null;
  
  const usedMatches = matches.slice(0, topK);
  
  // Collect returns at horizon from all matches
  const returns: number[] = [];
  for (const m of usedMatches) {
    const v = m.aftermathNormalized?.[horizonIndex];
    if (Number.isFinite(v)) {
      returns.push(v);
    }
  }
  
  if (returns.length === 0) return null;
  
  // Sort for percentile calculation
  returns.sort((a, b) => a - b);
  
  // Synthetic = p50 (median)
  const syntheticReturn = percentile(returns, 0.5);
  
  // Calculate entropy from similarity distribution
  const similarities = usedMatches.map(m => m.similarity);
  const avgSim = mean(similarities);
  const simStd = stdDev(similarities);
  const entropy = Math.min(1, Math.max(0, simStd / Math.max(avgSim, 0.01)));
  
  // Hybrid weight calculation (A3.6: using configurable mode)
  const topMatch = usedMatches[0];
  const similarity = topMatch.similarity;
  const replayWeight = computeReplayWeight(similarity, entropy, weightMode, weightClampMax);
  
  // Replay return from top match
  const replayReturn = topMatch.aftermathNormalized?.[horizonIndex] ?? 0;
  
  // Hybrid = weighted blend
  const hybridReturn = (1 - replayWeight) * syntheticReturn + replayWeight * replayReturn;
  
  return {
    syntheticReturn,
    hybridReturn,
    similarity,
    entropy,
    replayWeight,
    matchDate: topMatch.endDate,
  };
}

// ═══════════════════════════════════════════════════════════════
// CORE: Determine direction based on threshold
// ═══════════════════════════════════════════════════════════════

function getDirection(predictedReturn: number, threshold: number): WalkDirection {
  if (predictedReturn > threshold) return 'UP';
  if (predictedReturn < -threshold) return 'DOWN';
  return 'FLAT';
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Run Walk-Forward Validation
// A3.6: Added weightMode and weightClampMax support
// ═══════════════════════════════════════════════════════════════

export async function runWalkForward(params: WalkRunParams): Promise<WalkRunResult> {
  const start = Date.now();
  
  const from = parseISODate(params.from);
  const to = parseISODate(params.to);
  const stepDays = params.stepDays ?? STEP_DAYS_DEFAULT;
  const windowLen = params.windowLen ?? WINDOW_LEN_DEFAULT;
  const topK = params.topK ?? TOPK_DEFAULT;
  const threshold = params.threshold ?? THRESHOLD_DEFAULT;
  const weightMode = params.weightMode ?? 'W0';
  const weightClampMax = params.weightClampMax ?? WEIGHT_CLAMP_MAX_DEFAULT;
  const modes = params.modes ?? ['SYNTHETIC', 'HYBRID'];
  const horizons = params.horizons ?? [7, 14, 30, 90];
  
  // Generate date range
  const dates = generateDateRange(from, to, stepDays);
  
  // Limit to prevent server overload
  const processedDates = dates.slice(0, MAX_PROCESSED_PER_REQUEST);
  
  let createdSignals = 0;
  let createdOutcomes = 0;
  let skippedNoData = 0;
  const errors: Array<{ date: string; error: string }> = [];
  
  for (const asOf of processedDates) {
    try {
      // Get candles up to asOf (CRITICAL: no future data!)
      const candles = await getCandlesUpTo(asOf);
      
      // Check if we have enough data
      if (candles.length < windowLen + Math.max(...horizons) + 120) {
        skippedNoData++;
        continue;
      }
      
      const currentPrice = candles[candles.length - 1].close;
      
      // Process each horizon
      for (const horizonDays of horizons) {
        // Scan for matches
        const matches = await scanMatchesWithAsOf(candles, windowLen, horizonDays, Math.max(topK, 10));
        
        if (matches.length === 0) {
          skippedNoData++;
          continue;
        }
        
        // Compute prediction (A3.6: pass weightMode and weightClampMax)
        const horizonIndex = horizonDays - 1;
        const prediction = computePrediction(matches, horizonIndex, topK, weightMode, weightClampMax);
        
        if (!prediction) {
          skippedNoData++;
          continue;
        }
        
        // Process each mode
        for (const mode of modes) {
          const predictedReturn = mode === 'SYNTHETIC' 
            ? prediction.syntheticReturn 
            : prediction.hybridReturn;
          
          const predictedDirection = getDirection(predictedReturn, threshold);
          
          // Upsert signal (idempotent)
          const signalFilter = {
            asOf,
            mode,
            horizonDays,
            windowLen,
            topK,
            threshold,
          };
          
          const signalUpdate = {
            $set: {
              currentPrice,
              predictedReturn: Math.round(predictedReturn * 10000) / 10000,
              predictedDirection,
              similarity: Math.round(prediction.similarity * 10000) / 10000,
              entropy: Math.round(prediction.entropy * 10000) / 10000,
              replayWeight: Math.round(prediction.replayWeight * 10000) / 10000,
              matchDate: prediction.matchDate ? parseISODate(prediction.matchDate) : null,
            },
            $setOnInsert: {
              createdAt: new Date(),
            },
          };
          
          const signalResult = await DxyWalkSignalModel.updateOne(
            signalFilter,
            signalUpdate,
            { upsert: true }
          );
          
          if (signalResult.upsertedCount > 0) {
            createdSignals++;
          }
          
          // Upsert outcome shell (idempotent)
          const targetDate = addDays(asOf, horizonDays);
          
          const outcomeFilter = {
            asOf,
            mode,
            horizonDays,
          };
          
          const outcomeUpdate = {
            $setOnInsert: {
              targetDate,
              entryPrice: currentPrice,
              exitPrice: null,
              actualReturn: null,
              hit: null,
              resolvedAt: null,
              createdAt: new Date(),
            },
          };
          
          const outcomeResult = await DxyWalkOutcomeModel.updateOne(
            outcomeFilter,
            outcomeUpdate,
            { upsert: true }
          );
          
          if (outcomeResult.upsertedCount > 0) {
            createdOutcomes++;
          }
        }
      }
    } catch (error: any) {
      errors.push({
        date: toISODate(asOf),
        error: error.message,
      });
    }
  }
  
  return {
    ok: true,
    processed: processedDates.length,
    createdSignals,
    createdOutcomes,
    skippedNoData,
    durationMs: Date.now() - start,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Resolve Walk-Forward Outcomes
// ═══════════════════════════════════════════════════════════════

export async function resolveWalkOutcomes(params: WalkResolveParams): Promise<WalkResolveResult> {
  const start = Date.now();
  
  const from = parseISODate(params.from);
  const to = parseISODate(params.to);
  
  // Find unresolved outcomes in date range
  const unresolvedOutcomes = await DxyWalkOutcomeModel.find({
    asOf: { $gte: from, $lte: to },
    exitPrice: null,
  }).lean();
  
  let resolved = 0;
  let skippedFuture = 0;
  
  const now = new Date();
  
  for (const outcome of unresolvedOutcomes) {
    // Check if target date is in the future
    if (outcome.targetDate > now) {
      skippedFuture++;
      continue;
    }
    
    // Get exit price (at or after target date)
    const exitCandle = await getCandleAtOrAfter(outcome.targetDate);
    
    if (!exitCandle) {
      skippedFuture++;
      continue;
    }
    
    // Calculate actual return
    const actualReturn = (exitCandle.close / outcome.entryPrice) - 1;
    
    // Get signal to determine hit
    const signal = await DxyWalkSignalModel.findOne({
      asOf: outcome.asOf,
      mode: outcome.mode,
      horizonDays: outcome.horizonDays,
    }).lean();
    
    let hit: boolean | null = null;
    
    if (signal && signal.predictedDirection !== 'FLAT') {
      if (signal.predictedDirection === 'UP') {
        hit = actualReturn > 0;
      } else if (signal.predictedDirection === 'DOWN') {
        hit = actualReturn < 0;
      }
    }
    
    // Update outcome
    await DxyWalkOutcomeModel.updateOne(
      { _id: outcome._id },
      {
        $set: {
          exitPrice: exitCandle.close,
          actualReturn: Math.round(actualReturn * 10000) / 10000,
          hit,
          resolvedAt: new Date(),
        },
      }
    );
    
    resolved++;
  }
  
  return {
    ok: true,
    attempted: unresolvedOutcomes.length,
    resolved,
    skippedFuture,
    durationMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Recompute Walk-Forward Metrics
// A3.6: Added equityFinal, equityMaxDD, actionableRate
// ═══════════════════════════════════════════════════════════════

export async function recomputeWalkMetrics(
  mode: WalkMode,
  horizonDays: number,
  from: Date,
  to: Date
): Promise<WalkSummaryResult> {
  // Get all resolved outcomes in range
  const outcomes = await DxyWalkOutcomeModel.find({
    asOf: { $gte: from, $lte: to },
    mode,
    horizonDays,
    exitPrice: { $ne: null },
  }).sort({ asOf: 1 }).lean();
  
  // Get corresponding signals
  const signals = await DxyWalkSignalModel.find({
    asOf: { $gte: from, $lte: to },
    mode,
    horizonDays,
  }).lean();
  
  // Build signal lookup
  const signalMap = new Map<string, typeof signals[0]>();
  for (const s of signals) {
    const key = `${toISODate(s.asOf)}-${s.mode}-${s.horizonDays}`;
    signalMap.set(key, s);
  }
  
  // Calculate metrics
  const samples = outcomes.length;
  let actionable = 0;
  let hits = 0;
  const actualReturns: number[] = [];
  const predictedReturns: number[] = [];
  const replayWeights: number[] = [];
  
  // A3.6: Equity curve for drawdown calculation
  const equityCurve: number[] = [1.0]; // Start with 1.0
  
  for (const outcome of outcomes) {
    const key = `${toISODate(outcome.asOf)}-${outcome.mode}-${outcome.horizonDays}`;
    const signal = signalMap.get(key);
    
    if (signal && signal.predictedDirection !== 'FLAT') {
      actionable++;
      
      if (outcome.hit === true) {
        hits++;
      }
      
      // A3.6: Update equity curve (only on actionable signals)
      if (outcome.actualReturn !== null) {
        // If prediction was correct direction, we gain; otherwise lose
        const lastEquity = equityCurve[equityCurve.length - 1];
        const tradeReturn = outcome.hit ? Math.abs(outcome.actualReturn) : -Math.abs(outcome.actualReturn);
        equityCurve.push(lastEquity * (1 + tradeReturn));
      }
    }
    
    if (outcome.actualReturn !== null) {
      actualReturns.push(outcome.actualReturn);
    }
    
    if (signal) {
      predictedReturns.push(signal.predictedReturn);
      replayWeights.push(signal.replayWeight);
    }
  }
  
  const hitRate = actionable > 0 ? hits / actionable : 0;
  const actionableRate = samples > 0 ? actionable / samples : 0;
  const avgReturn = mean(actualReturns);
  const avgPredictedReturn = mean(predictedReturns);
  const bias = avgPredictedReturn - avgReturn;
  const avgReplayWeight = mean(replayWeights);
  const replayWeightStd = stdDev(replayWeights);
  
  // A3.6: Calculate equity metrics
  const equityFinal = equityCurve[equityCurve.length - 1];
  let equityMaxDD = 0;
  let peak = equityCurve[0];
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > equityMaxDD) equityMaxDD = dd;
  }
  
  // Upsert metrics
  const metricsFilter = {
    mode,
    horizonDays,
    from,
    to,
  };
  
  const metricsUpdate = {
    $set: {
      samples,
      actionable,
      hitRate: Math.round(hitRate * 10000) / 10000,
      avgReturn: Math.round(avgReturn * 10000) / 10000,
      avgPredictedReturn: Math.round(avgPredictedReturn * 10000) / 10000,
      bias: Math.round(bias * 10000) / 10000,
      avgReplayWeight: Math.round(avgReplayWeight * 10000) / 10000,
      replayWeightStd: Math.round(replayWeightStd * 10000) / 10000,
      computedAt: new Date(),
    },
  };
  
  await DxyWalkMetricsModel.updateOne(metricsFilter, metricsUpdate, { upsert: true });
  
  return {
    ok: true,
    mode,
    horizonDays,
    from: toISODate(from),
    to: toISODate(to),
    samples,
    actionable,
    actionableRate: Math.round(actionableRate * 10000) / 10000,
    hitRate: Math.round(hitRate * 10000) / 10000,
    avgReturn: Math.round(avgReturn * 10000) / 10000,
    avgPredictedReturn: Math.round(avgPredictedReturn * 10000) / 10000,
    bias: Math.round(bias * 10000) / 10000,
    avgReplayWeight: Math.round(avgReplayWeight * 10000) / 10000,
    replayWeightStd: Math.round(replayWeightStd * 10000) / 10000,
    equityFinal: Math.round(equityFinal * 10000) / 10000,
    equityMaxDD: Math.round(equityMaxDD * 10000) / 10000,
    computedAt: new Date().toISOString(),
  };
}
