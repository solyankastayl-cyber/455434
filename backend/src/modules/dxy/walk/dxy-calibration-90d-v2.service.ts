/**
 * A3.7.v2 — 90d Controlled Tightening Service
 * 
 * Quality Gate + Replay Winsorization + Train/Val/OOS validation
 */

import { v4 as uuidv4 } from 'uuid';
import { DxyCandleModel } from '../storage/dxy-candles.model.js';
import { DxyWalkSignalModel } from './models/dxy_walk_signal.model.js';
import { DxyWalkOutcomeModel } from './models/dxy_walk_outcome.model.js';
import { DxyCalibrationRunModel } from './models/dxy_calibration_run.model.js';
import {
  ACCEPTANCE_90D_V2,
  WINSOR_QUANTILES,
  DEFAULT_QUALITY_GATE,
  type Grid90dV2Request,
  type Grid90dV2Response,
  type GridConfigResultV2,
  type ConfigUsedV2,
  type PeriodMetrics,
  type DxyQualityGate,
  type ReplayWinsorMode,
} from './dxy-calibration-90d-v2.types.js';
import type { WeightMode } from './dxy-walk.types.js';
import {
  normalizeToRange,
  computeSimilarity,
  toPctFromLast,
} from '../utils/normalize.js';

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

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function parseISODate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Get candles up to date
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
// HELPER: Scan matches with aftermath
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
  
  matches.sort((a, b) => b.similarity - a.similarity);
  
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
// CORE: Compute replay weight (W2/W3)
// ═══════════════════════════════════════════════════════════════

function computeReplayWeight(
  similarity: number,
  entropy: number,
  weightMode: WeightMode
): number {
  let wRaw: number;
  
  switch (weightMode) {
    case 'W2':
      wRaw = (similarity * similarity) * (1 - entropy);
      break;
    case 'W3':
      wRaw = similarity * (1 - 1.5 * entropy);
      break;
    default:
      wRaw = similarity * (1 - entropy);
      break;
  }
  
  return Math.min(0.5, Math.max(0, wRaw));
}

// ═══════════════════════════════════════════════════════════════
// CORE: Apply winsorization to replay path
// ═══════════════════════════════════════════════════════════════

function applyWinsorization(
  replayPct: number[],
  allHistoricalAftermath: number[][],
  mode: ReplayWinsorMode
): number[] {
  if (mode === 'OFF') return replayPct;
  
  const [lowerQ, upperQ] = WINSOR_QUANTILES[mode];
  
  // For each time step, compute quantiles from all historical aftermath
  return replayPct.map((val, t) => {
    const valuesAtT = allHistoricalAftermath
      .map(aftermath => aftermath[t])
      .filter(v => Number.isFinite(v))
      .sort((a, b) => a - b);
    
    if (valuesAtT.length === 0) return val;
    
    const lower = percentile(valuesAtT, lowerQ);
    const upper = percentile(valuesAtT, upperQ);
    
    return Math.min(upper, Math.max(lower, val));
  });
}

// ═══════════════════════════════════════════════════════════════
// CORE: Compute prediction with quality gate
// ═══════════════════════════════════════════════════════════════

interface PredictionResultV2 {
  syntheticReturn: number;
  hybridReturn: number;
  similarity: number;
  entropy: number;
  replayWeight: number;
  matchDate: string | null;
  passedGate: boolean;
  gateReason?: string;
}

function computePredictionV2(
  matches: MatchWithAftermath[],
  horizonIndex: number,
  topK: number,
  weightMode: WeightMode,
  winsorMode: ReplayWinsorMode,
  qualityGate: DxyQualityGate
): PredictionResultV2 | null {
  if (matches.length === 0) return null;
  
  const usedMatches = matches.slice(0, topK);
  
  // Collect returns at horizon
  const returns: number[] = [];
  const allAftermath = usedMatches.map(m => m.aftermathNormalized);
  
  for (const m of usedMatches) {
    const v = m.aftermathNormalized?.[horizonIndex];
    if (Number.isFinite(v)) {
      returns.push(v);
    }
  }
  
  if (returns.length === 0) return null;
  
  returns.sort((a, b) => a - b);
  const syntheticReturn = percentile(returns, 0.5);
  
  // Entropy
  const similarities = usedMatches.map(m => m.similarity);
  const avgSim = mean(similarities);
  const simStd = stdDev(similarities);
  const entropy = Math.min(1, Math.max(0, simStd / Math.max(avgSim, 0.01)));
  
  // Top match
  const topMatch = usedMatches[0];
  const similarity = topMatch.similarity;
  const replayWeight = computeReplayWeight(similarity, entropy, weightMode);
  
  // Replay return (with winsorization)
  let replayPct = topMatch.aftermathNormalized || [];
  if (winsorMode !== 'OFF') {
    replayPct = applyWinsorization(replayPct, allAftermath, winsorMode);
  }
  const replayReturn = replayPct[horizonIndex] ?? 0;
  
  // Hybrid
  const hybridReturn = (1 - replayWeight) * syntheticReturn + replayWeight * replayReturn;
  
  // Quality gate check
  let passedGate = true;
  let gateReason = '';
  
  if (qualityGate.enabled) {
    if (similarity < qualityGate.similarityMin) {
      passedGate = false;
      gateReason = `similarity ${similarity.toFixed(3)} < ${qualityGate.similarityMin}`;
    } else if (entropy > qualityGate.entropyMax) {
      passedGate = false;
      gateReason = `entropy ${entropy.toFixed(3)} > ${qualityGate.entropyMax}`;
    } else if (Math.abs(hybridReturn) < qualityGate.absReturnMin) {
      passedGate = false;
      gateReason = `absReturn ${Math.abs(hybridReturn).toFixed(4)} < ${qualityGate.absReturnMin}`;
    } else if (replayWeight < qualityGate.replayWeightMin) {
      passedGate = false;
      gateReason = `replayWeight ${replayWeight.toFixed(3)} < ${qualityGate.replayWeightMin}`;
    }
  }
  
  return {
    syntheticReturn,
    hybridReturn,
    similarity,
    entropy,
    replayWeight,
    matchDate: topMatch.endDate,
    passedGate,
    gateReason,
  };
}

// ═══════════════════════════════════════════════════════════════
// CORE: Run walk-forward for a single period
// ═══════════════════════════════════════════════════════════════

async function runWalkForwardPeriod(
  from: string,
  to: string,
  stepDays: number,
  config: ConfigUsedV2
): Promise<PeriodMetrics> {
  const fromDate = parseISODate(from);
  const toDate = parseISODate(to);
  const horizonDays = 90;
  const threshold = config.threshold;
  
  // Generate date range
  const dates: Date[] = [];
  const current = new Date(fromDate);
  while (current <= toDate) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + stepDays);
  }
  
  // Track results
  let trades = 0;
  let hits = 0;
  const equityCurve: number[] = [1.0];
  const actualReturns: number[] = [];
  const predictedReturns: number[] = [];
  let totalSignals = 0;
  
  for (const asOf of dates) {
    const candles = await getCandlesUpTo(asOf);
    
    if (candles.length < config.windowLen + horizonDays + 120) {
      continue;
    }
    
    totalSignals++;
    const currentPrice = candles[candles.length - 1].close;
    
    // Scan matches
    const matches = await scanMatchesWithAsOf(candles, config.windowLen, horizonDays, Math.max(config.topK, 10));
    if (matches.length === 0) continue;
    
    // Compute prediction
    const prediction = computePredictionV2(
      matches,
      horizonDays - 1,
      config.topK,
      config.weightMode,
      config.winsor,
      config.qualityGate
    );
    
    if (!prediction) continue;
    
    // Skip if gate not passed (quality filtering)
    if (!prediction.passedGate) continue;
    
    const predictedReturn = prediction.hybridReturn;
    
    // Determine direction
    const direction = predictedReturn > threshold ? 'UP' : 
                      predictedReturn < -threshold ? 'DOWN' : 'FLAT';
    
    if (direction === 'FLAT') continue;
    
    // Get actual outcome
    const targetDate = addDays(asOf, horizonDays);
    const exitCandle = await getCandleAtOrAfter(targetDate);
    if (!exitCandle) continue;
    
    const actualReturn = (exitCandle.close / currentPrice) - 1;
    actualReturns.push(actualReturn);
    predictedReturns.push(predictedReturn);
    
    // Check hit
    const isHit = (direction === 'UP' && actualReturn > 0) ||
                  (direction === 'DOWN' && actualReturn < 0);
    
    trades++;
    if (isHit) hits++;
    
    // Update equity
    const lastEquity = equityCurve[equityCurve.length - 1];
    const tradeReturn = isHit ? Math.abs(actualReturn) : -Math.abs(actualReturn);
    equityCurve.push(lastEquity * (1 + tradeReturn));
  }
  
  // Calculate metrics
  const equityFinal = equityCurve[equityCurve.length - 1];
  
  let maxDD = 0;
  let peak = equityCurve[0];
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  
  const hitRate = trades > 0 ? hits / trades : 0;
  const avgReturn = mean(actualReturns);
  const avgPredicted = mean(predictedReturns);
  const bias = avgPredicted - avgReturn;
  const actionableRate = totalSignals > 0 ? trades / totalSignals : 0;
  
  return {
    equityFinal: Math.round(equityFinal * 10000) / 10000,
    maxDD: Math.round(maxDD * 10000) / 10000,
    hitRate: Math.round(hitRate * 10000) / 10000,
    bias: Math.round(bias * 10000) / 10000,
    trades,
    actionableRate: Math.round(actionableRate * 10000) / 10000,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Check acceptance
// ═══════════════════════════════════════════════════════════════

function checkAcceptanceV2(train: PeriodMetrics, val: PeriodMetrics, oos: PeriodMetrics): { passed: boolean; reason: string } {
  const { train: trainReq, val: valReq, oos: oosReq } = ACCEPTANCE_90D_V2;
  
  if (train.equityFinal < trainReq.equityMin) {
    return { passed: false, reason: `train.equity ${train.equityFinal} < ${trainReq.equityMin}` };
  }
  
  if (val.equityFinal < valReq.equityMin) {
    return { passed: false, reason: `val.equity ${val.equityFinal} < ${valReq.equityMin}` };
  }
  if (val.maxDD > valReq.maxDDMax) {
    return { passed: false, reason: `val.maxDD ${val.maxDD} > ${valReq.maxDDMax}` };
  }
  
  if (oos.equityFinal < oosReq.equityMin) {
    return { passed: false, reason: `oos.equity ${oos.equityFinal} < ${oosReq.equityMin}` };
  }
  if (oos.maxDD > oosReq.maxDDMax) {
    return { passed: false, reason: `oos.maxDD ${oos.maxDD} > ${oosReq.maxDDMax}` };
  }
  if (Math.abs(oos.bias) > oosReq.biasAbsMax) {
    return { passed: false, reason: `oos.bias ${oos.bias} > ±${oosReq.biasAbsMax}` };
  }
  if (oos.trades < oosReq.tradesMin) {
    return { passed: false, reason: `oos.trades ${oos.trades} < ${oosReq.tradesMin}` };
  }
  
  return { passed: true, reason: 'all criteria met' };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Score for ranking
// ═══════════════════════════════════════════════════════════════

function scoreResultV2(r: GridConfigResultV2): number {
  // Sort by: OOS equity (desc), OOS maxDD (asc), VAL equity (desc)
  return (
    r.oos.equityFinal * 10000 -
    r.oos.maxDD * 1000 +
    r.val.equityFinal * 100
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Run grid-90d-v2
// ═══════════════════════════════════════════════════════════════

export async function runGrid90dV2(req: Grid90dV2Request): Promise<Grid90dV2Response> {
  const start = Date.now();
  const runId = uuidv4();
  
  const stepDays = req.stepDays ?? 7;
  const topK = req.topK ?? 10;
  const grid = req.grid;
  
  // Generate all combinations
  const combinations: ConfigUsedV2[] = [];
  
  for (const windowLen of grid.windowLen) {
    for (const threshold of grid.threshold) {
      for (const weightMode of grid.weightMode) {
        for (const winsor of grid.winsor) {
          for (const similarityMin of grid.similarityMin) {
            for (const entropyMax of grid.entropyMax) {
              for (const absReturnMin of grid.absReturnMin) {
                for (const replayWeightMin of grid.replayWeightMin) {
                  combinations.push({
                    windowLen,
                    threshold,
                    weightMode,
                    topK,
                    winsor,
                    qualityGate: {
                      enabled: true,
                      similarityMin,
                      entropyMax,
                      absReturnMin,
                      replayWeightMin,
                    },
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  
  console.log(`[A3.7.v2] Starting 90d grid with ${combinations.length} combinations...`);
  
  const results: GridConfigResultV2[] = [];
  
  for (let i = 0; i < combinations.length; i++) {
    const config = combinations[i];
    const gate = config.qualityGate;
    
    console.log(`[A3.7.v2] Running ${i + 1}/${combinations.length}: win=${config.windowLen}, thr=${config.threshold}, mode=${config.weightMode}, winsor=${config.winsor}, simMin=${gate.similarityMin}, entMax=${gate.entropyMax}`);
    
    try {
      // Run on train period
      const train = await runWalkForwardPeriod(req.trainFrom, req.trainTo, stepDays, config);
      
      // Run on val period
      const val = await runWalkForwardPeriod(req.valFrom, req.valTo, stepDays, config);
      
      // Run on OOS period
      const oos = await runWalkForwardPeriod(req.oosFrom, req.oosTo, stepDays, config);
      
      // Check acceptance
      const acceptance = checkAcceptanceV2(train, val, oos);
      
      results.push({
        configUsed: config,
        train,
        val,
        oos,
        passed: acceptance.passed,
        passReason: acceptance.reason,
      });
      
    } catch (error: any) {
      console.error(`[A3.7.v2] Error:`, error.message);
      results.push({
        configUsed: config,
        train: { equityFinal: 0, maxDD: 1, hitRate: 0, bias: 0, trades: 0, actionableRate: 0 },
        val: { equityFinal: 0, maxDD: 1, hitRate: 0, bias: 0, trades: 0, actionableRate: 0 },
        oos: { equityFinal: 0, maxDD: 1, hitRate: 0, bias: 0, trades: 0, actionableRate: 0 },
        passed: false,
        passReason: error.message,
      });
    }
  }
  
  // Sort by score
  results.sort((a, b) => scoreResultV2(b) - scoreResultV2(a));
  
  // Get passed configs
  const passedResults = results.filter(r => r.passed);
  const best = passedResults.length > 0 ? passedResults[0] : null;
  const top5 = results.slice(0, 5);
  
  console.log(`[A3.7.v2] Grid complete. ${passedResults.length}/${results.length} passed.`);
  if (best) {
    console.log(`[A3.7.v2] BEST: win=${best.configUsed.windowLen}, thr=${best.configUsed.threshold}, mode=${best.configUsed.weightMode}`);
    console.log(`[A3.7.v2] BEST OOS: equity=${best.oos.equityFinal}, DD=${best.oos.maxDD}, hit=${best.oos.hitRate}`);
  }
  
  return {
    ok: true,
    runId,
    totalConfigs: combinations.length,
    passedConfigs: passedResults.length,
    results,
    top5,
    best,
    durationMs: Date.now() - start,
  };
}
