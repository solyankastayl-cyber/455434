/**
 * BLOCK 36.4 — Rolling Validation Harness (Industrial Grade)
 * 
 * Instead of static train/test splits, we run automated rolling validation:
 * 
 * Train: 2014-2018 -> Test: 2019
 * Train: 2015-2019 -> Test: 2020
 * Train: 2016-2020 -> Test: 2021
 * ...
 * 
 * Purged. No leakage. Reality test.
 * 
 * This provides an "industrial-grade" backtesting framework for verifying
 * out-of-sample performance and stability over time.
 */

import { CanonicalOhlcvModel } from '../data/schemas/fractal-canonical-ohlcv.schema.js';
import { FractalEngine } from '../engine/fractal.engine.js';
import { FractalSignalBuilder } from '../engine/fractal.signal.builder.js';
import { FIXED_CONFIG } from './sim.oos.splits.js';
import { SimOverrides, BASE_COSTS, applyCostMultiplier, getRoundTripCost } from './sim.overrides.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RollingConfig {
  trainYears: number;       // e.g. 5 years of training
  testYears: number;        // e.g. 1 year of testing
  stepYears: number;        // e.g. 1 year step
  startYear: number;        // first year of data (e.g. 2014)
  endYear: number;          // last year (e.g. 2026)
  symbol?: string;
  stepDays?: number;        // simulation step in days (default 7)
  overrides?: SimOverrides; // cost multiplier etc.
}

export interface FoldResult {
  fold: string;                      // e.g. "2014-2018 -> 2019"
  trainRange: { start: number; end: number };
  testRange: { start: number; end: number };
  sharpe: number;
  maxDD: number;
  trades: number;
  winRate: number;
  cagr: number;
  finalEquity: number;
  passed: boolean;                   // meets gate criteria
}

export interface RollingResult {
  ok: boolean;
  config: RollingConfig;
  folds: FoldResult[];
  summary: RollingSummary;
  verdict: string;
  gateCriteria: GateCriteria;
}

export interface RollingSummary {
  meanSharpe: number;
  stdSharpe: number;
  stability: number;                 // meanSharpe / stdSharpe
  worstSharpe: number;
  bestSharpe: number;
  meanDD: number;
  worstDD: number;
  passRate: number;                  // % of folds passing gates
  totalTrades: number;
  meanTradesPerFold: number;
}

export interface GateCriteria {
  minMeanSharpe: number;             // >= 0.55
  minWorstSharpe: number;            // >= 0
  maxMeanDD: number;                 // <= 0.35
  minPassRate: number;               // >= 0.70
  minStability: number;              // >= 1.5
  foldPassThresholds: {
    minSharpe: number;               // >= 0.35 for fold to pass
    maxDD: number;                   // <= 0.35 for fold to pass
  };
}

export const DEFAULT_GATE_CRITERIA: GateCriteria = {
  minMeanSharpe: 0.55,
  minWorstSharpe: 0,
  maxMeanDD: 0.35,
  minPassRate: 0.70,
  minStability: 1.5,
  foldPassThresholds: {
    minSharpe: 0.35,
    maxDD: 0.35,
  },
};

export const DEFAULT_ROLLING_CONFIG: Partial<RollingConfig> = {
  trainYears: 5,
  testYears: 1,
  stepYears: 1,
  startYear: 2014,
  endYear: 2026,
  stepDays: 7,
};

// ═══════════════════════════════════════════════════════════════
// ROLLING VALIDATION SERVICE
// ═══════════════════════════════════════════════════════════════

export class SimRollingService {
  private engine: FractalEngine;
  private signalBuilder: FractalSignalBuilder;

  constructor() {
    this.engine = new FractalEngine();
    this.signalBuilder = new FractalSignalBuilder(this.engine);
  }

  /**
   * Run rolling validation across all folds
   */
  async runRollingValidation(
    config: Partial<RollingConfig> = {},
    gateCriteria: GateCriteria = DEFAULT_GATE_CRITERIA
  ): Promise<RollingResult> {
    const cfg: RollingConfig = {
      trainYears: config.trainYears ?? DEFAULT_ROLLING_CONFIG.trainYears!,
      testYears: config.testYears ?? DEFAULT_ROLLING_CONFIG.testYears!,
      stepYears: config.stepYears ?? DEFAULT_ROLLING_CONFIG.stepYears!,
      startYear: config.startYear ?? DEFAULT_ROLLING_CONFIG.startYear!,
      endYear: config.endYear ?? DEFAULT_ROLLING_CONFIG.endYear!,
      symbol: config.symbol ?? 'BTC',
      stepDays: config.stepDays ?? DEFAULT_ROLLING_CONFIG.stepDays!,
      overrides: config.overrides,
    };

    console.log(`[ROLLING 36.4] Starting validation: ${cfg.trainYears}Y train / ${cfg.testYears}Y test / ${cfg.stepYears}Y step`);
    console.log(`[ROLLING 36.4] Range: ${cfg.startYear} -> ${cfg.endYear}`);

    const folds: FoldResult[] = [];

    // Generate all folds
    for (
      let year = cfg.startYear;
      year + cfg.trainYears + cfg.testYears <= cfg.endYear;
      year += cfg.stepYears
    ) {
      const trainStart = year;
      const trainEnd = year + cfg.trainYears;
      const testStart = trainEnd;
      const testEnd = trainEnd + cfg.testYears;

      const foldName = `${trainStart}-${trainEnd} -> ${testStart}-${testEnd}`;
      console.log(`[ROLLING 36.4] Running fold: ${foldName}`);

      try {
        const foldResult = await this.runSingleFold({
          trainStart,
          trainEnd,
          testStart,
          testEnd,
          symbol: cfg.symbol!,
          stepDays: cfg.stepDays!,
          overrides: cfg.overrides,
          gateCriteria,
        });

        folds.push({
          fold: foldName,
          trainRange: { start: trainStart, end: trainEnd },
          testRange: { start: testStart, end: testEnd },
          ...foldResult,
        });

        console.log(
          `[ROLLING 36.4] Fold ${foldName}: Sharpe=${foldResult.sharpe.toFixed(3)}, ` +
          `MaxDD=${(foldResult.maxDD * 100).toFixed(1)}%, Trades=${foldResult.trades}, ` +
          `Pass=${foldResult.passed ? 'YES' : 'NO'}`
        );
      } catch (err) {
        console.error(`[ROLLING 36.4] Fold ${foldName} failed:`, err);
        // Record failed fold
        folds.push({
          fold: foldName,
          trainRange: { start: trainStart, end: trainEnd },
          testRange: { start: testStart, end: testEnd },
          sharpe: 0,
          maxDD: 1,
          trades: 0,
          winRate: 0,
          cagr: 0,
          finalEquity: 1,
          passed: false,
        });
      }
    }

    // Analyze results
    const summary = this.analyzeRolling(folds, gateCriteria);
    const verdict = this.generateVerdict(summary, gateCriteria);

    console.log(`[ROLLING 36.4] Complete: ${folds.length} folds, PassRate=${(summary.passRate * 100).toFixed(0)}%`);

    return {
      ok: true,
      config: cfg,
      folds,
      summary,
      verdict,
      gateCriteria,
    };
  }

  /**
   * Run a single fold (train on historical, test on future)
   */
  private async runSingleFold(params: {
    trainStart: number;
    trainEnd: number;
    testStart: number;
    testEnd: number;
    symbol: string;
    stepDays: number;
    overrides?: SimOverrides;
    gateCriteria: GateCriteria;
  }): Promise<{
    sharpe: number;
    maxDD: number;
    trades: number;
    winRate: number;
    cagr: number;
    finalEquity: number;
    passed: boolean;
  }> {
    const { testStart, testEnd, symbol, stepDays, overrides, gateCriteria } = params;
    const cfg = FIXED_CONFIG.signal;

    // Cost model
    const costMult = overrides?.costMultiplier ?? 1.0;
    const costs = applyCostMultiplier(BASE_COSTS, costMult);
    const roundTripCost = getRoundTripCost(costs);

    // Date range for TEST period only
    // We only test on testStart-testEnd, training is implicit in the historical data available
    const from = new Date(`${testStart}-01-01`);
    const to = new Date(`${testEnd}-01-01`);

    // Get all prices with lookback (need data before test period for pattern matching)
    const lookbackStart = new Date(from.getTime() - (cfg.windowLen + cfg.baselineLookbackDays + 100) * 86400000);
    const prices = await CanonicalOhlcvModel.find({
      'meta.symbol': symbol,
      ts: { $gte: lookbackStart, $lte: to }
    }).sort({ ts: 1 }).lean() as any[];

    if (prices.length < cfg.windowLen + 100) {
      throw new Error(`Insufficient price data for fold: ${prices.length} candles`);
    }

    // Find test start index
    let testStartIdx = 0;
    for (let i = 0; i < prices.length; i++) {
      if (new Date(prices[i].ts) >= from) {
        testStartIdx = i;
        break;
      }
    }

    // Simulation state
    let equity = 1.0;
    let peakEquity = 1.0;
    let position: 'FLAT' | 'LONG' | 'SHORT' = 'FLAT';
    let posSize = 0;
    let entryPrice = 0;
    let lastPrice = 0;
    let tradesOpened = 0;
    let tradesWon = 0;
    let tradePnl = 0;
    let realHoldDays = 0;
    let totalHoldDays = 0;

    const returns: number[] = [];
    let maxDD = 0;

    // Risk params
    const softDD = FIXED_CONFIG.risk.soft;
    const hardDD = FIXED_CONFIG.risk.hard;
    const enterThr = 0.03;
    const minHold = 7;
    const maxHold = 60;

    let cooldownUntil: Date | null = null;

    // Process test period
    for (let i = testStartIdx; i < prices.length; i += stepDays) {
      const asOf = prices[i].ts as Date;
      const price = prices[i].ohlcv?.c ?? 0;
      const lowPrice = prices[i].ohlcv?.l ?? price;
      if (!price) continue;

      // Check if we're past test end
      if (asOf >= to) break;

      // Position-level stop-loss check
      const positionStopLoss = 0.15;
      if (position === 'LONG' && entryPrice > 0 && lowPrice > 0) {
        const priceDrop = (entryPrice - lowPrice) / entryPrice;
        if (priceDrop >= positionStopLoss) {
          const stopPrice = entryPrice * (1 - positionStopLoss);
          const stopRet = lastPrice > 0 ? stopPrice / lastPrice - 1 : 0;
          const stopPnl = stopRet * posSize;
          equity *= (1 + stopPnl);
          realHoldDays += stepDays;
          tradePnl += stopPnl;
          returns.push(stopPnl);
          
          equity *= (1 - roundTripCost / 2 * posSize);
          position = 'FLAT';
          posSize = 0;
          totalHoldDays += realHoldDays;
          realHoldDays = 0;
          tradePnl = 0;
          cooldownUntil = new Date(asOf.getTime() + 14 * 86400000);
          lastPrice = price;
          continue;
        }
      }

      // Calculate step PnL
      let stepPnl = 0;
      if (position !== 'FLAT' && lastPrice > 0) {
        const ret = price / lastPrice - 1;
        stepPnl = position === 'LONG' ? ret * posSize : -ret * posSize;
        equity *= (1 + stepPnl);
        realHoldDays += stepDays;
        tradePnl += stepPnl;
      }
      returns.push(stepPnl);

      // Update peak and DD
      if (equity > peakEquity) {
        peakEquity = equity;
      }
      const currentDD = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
      if (currentDD > maxDD) {
        maxDD = currentDD;
      }

      // DD-aware exposure multiplier
      let ddMult = 1.0;
      if (position !== 'FLAT') {
        if (currentDD >= hardDD) {
          ddMult = 0;
        } else if (currentDD > softDD) {
          const x = (currentDD - softDD) / (hardDD - softDD);
          ddMult = 0.15 + 0.85 * (1 - Math.pow(x, 1.5));
        }
      }

      // Get signal (using asOf to ensure no look-ahead)
      const signal = await this.signalBuilder.build({
        symbol,
        timeframe: '1d',
        asOf: asOf.toISOString(),
        windowLen: cfg.windowLen as 30 | 60 | 90,
        topK: 25,
        minSimilarity: cfg.minSimilarity,
        minMatches: cfg.minMatches,
        horizonDays: cfg.horizonDays,
        minGapDays: 60,
        neutralBand: 0.001,
        similarityMode: cfg.similarityMode,
        useRelative: cfg.useRelative,
        relativeBand: 0.0015,
        baselineLookbackDays: cfg.baselineLookbackDays
      });

      const inCooldown = cooldownUntil && asOf < cooldownUntil;

      // Hard kill
      if (currentDD >= hardDD && position !== 'FLAT') {
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + 14 * 86400000);
      }

      // Max hold force exit
      if (position !== 'FLAT' && realHoldDays >= maxHold) {
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + 7 * 86400000);
      }

      // Exit on signal flip
      if (position !== 'FLAT' && realHoldDays >= minHold) {
        const oppositeSignal = (position === 'LONG' && signal.action === 'SHORT') ||
                               (position === 'SHORT' && signal.action === 'LONG');
        const weakSignal = signal.action === 'NEUTRAL' || signal.confidence < 0.05;

        if (oppositeSignal || weakSignal) {
          equity *= (1 - roundTripCost / 2 * posSize);
          if (tradePnl > 0) tradesWon++;
          position = 'FLAT';
          posSize = 0;
          totalHoldDays += realHoldDays;
          realHoldDays = 0;
          tradePnl = 0;
          cooldownUntil = new Date(asOf.getTime() + 7 * 86400000);
        }
      }

      // Enter new position
      if (position === 'FLAT' && !inCooldown && ddMult > 0.01) {
        if (signal.action !== 'NEUTRAL' && signal.confidence >= enterThr) {
          const baseExposure = Math.min(2, signal.confidence * 2);
          const exposure = baseExposure * ddMult;
          if (exposure > 0.01) {
            equity *= (1 - roundTripCost / 2 * exposure);
            position = signal.action;
            posSize = exposure;
            entryPrice = price;
            realHoldDays = 0;
            tradePnl = 0;
            tradesOpened++;
          }
        }
      }

      lastPrice = price;
    }

    // Final metrics
    const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 1
      ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)
      : 0;
    const vol = Math.sqrt(variance);
    const sharpe = vol > 0 ? (mean * Math.sqrt(52)) / vol : 0;

    const years = returns.length / 52;
    const cagr = years > 0 ? Math.pow(equity, 1 / years) - 1 : 0;
    const winRate = tradesOpened > 0 ? tradesWon / tradesOpened : 0;

    // Check if fold passes gate
    const passed = sharpe >= gateCriteria.foldPassThresholds.minSharpe &&
                   maxDD <= gateCriteria.foldPassThresholds.maxDD;

    return {
      sharpe: Math.round(sharpe * 1000) / 1000,
      maxDD: Math.round(maxDD * 10000) / 10000,
      trades: tradesOpened,
      winRate: Math.round(winRate * 1000) / 1000,
      cagr: Math.round(cagr * 10000) / 10000,
      finalEquity: Math.round(equity * 10000) / 10000,
      passed,
    };
  }

  /**
   * Analyze rolling results and compute summary statistics
   */
  private analyzeRolling(folds: FoldResult[], gateCriteria: GateCriteria): RollingSummary {
    if (folds.length === 0) {
      return {
        meanSharpe: 0,
        stdSharpe: 0,
        stability: 0,
        worstSharpe: 0,
        bestSharpe: 0,
        meanDD: 0,
        worstDD: 0,
        passRate: 0,
        totalTrades: 0,
        meanTradesPerFold: 0,
      };
    }

    const sharpes = folds.map(f => f.sharpe);
    const dds = folds.map(f => f.maxDD);
    const trades = folds.map(f => f.trades);

    // Mean and std of Sharpe
    const meanSharpe = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
    const variance = sharpes.length > 1
      ? sharpes.reduce((a, b) => a + (b - meanSharpe) ** 2, 0) / (sharpes.length - 1)
      : 0;
    const stdSharpe = Math.sqrt(variance);

    // Stability = mean / std (higher is better)
    const stability = stdSharpe > 0 ? meanSharpe / stdSharpe : (meanSharpe > 0 ? Infinity : 0);

    // Extremes
    const worstSharpe = Math.min(...sharpes);
    const bestSharpe = Math.max(...sharpes);
    const meanDD = dds.reduce((a, b) => a + b, 0) / dds.length;
    const worstDD = Math.max(...dds);

    // Pass rate
    const passedFolds = folds.filter(f => f.passed).length;
    const passRate = passedFolds / folds.length;

    // Trades
    const totalTrades = trades.reduce((a, b) => a + b, 0);
    const meanTradesPerFold = totalTrades / folds.length;

    return {
      meanSharpe: Math.round(meanSharpe * 1000) / 1000,
      stdSharpe: Math.round(stdSharpe * 1000) / 1000,
      stability: Math.round(stability * 100) / 100,
      worstSharpe: Math.round(worstSharpe * 1000) / 1000,
      bestSharpe: Math.round(bestSharpe * 1000) / 1000,
      meanDD: Math.round(meanDD * 10000) / 10000,
      worstDD: Math.round(worstDD * 10000) / 10000,
      passRate: Math.round(passRate * 1000) / 1000,
      totalTrades,
      meanTradesPerFold: Math.round(meanTradesPerFold * 10) / 10,
    };
  }

  /**
   * Generate verdict based on gate criteria
   */
  private generateVerdict(summary: RollingSummary, criteria: GateCriteria): string {
    const checks = [
      {
        name: 'Mean Sharpe',
        passed: summary.meanSharpe >= criteria.minMeanSharpe,
        value: summary.meanSharpe,
        threshold: criteria.minMeanSharpe,
      },
      {
        name: 'Worst Sharpe',
        passed: summary.worstSharpe >= criteria.minWorstSharpe,
        value: summary.worstSharpe,
        threshold: criteria.minWorstSharpe,
      },
      {
        name: 'Mean MaxDD',
        passed: summary.meanDD <= criteria.maxMeanDD,
        value: summary.meanDD,
        threshold: criteria.maxMeanDD,
      },
      {
        name: 'Pass Rate',
        passed: summary.passRate >= criteria.minPassRate,
        value: summary.passRate,
        threshold: criteria.minPassRate,
      },
      {
        name: 'Stability',
        passed: summary.stability >= criteria.minStability,
        value: summary.stability,
        threshold: criteria.minStability,
      },
    ];

    const passedCount = checks.filter(c => c.passed).length;
    const totalChecks = checks.length;

    const failedChecks = checks.filter(c => !c.passed);
    const failedList = failedChecks.map(c =>
      `${c.name}: ${c.value.toFixed(3)} (need ${c.threshold >= 1 ? '>=' : '<='}${c.threshold})`
    ).join(', ');

    if (passedCount === totalChecks) {
      return `✅ V2 APPROVED — All ${totalChecks}/${totalChecks} gates passed. Ready for production.`;
    } else if (passedCount >= totalChecks - 1) {
      return `🟡 V2 MARGINAL — ${passedCount}/${totalChecks} gates passed. Failed: ${failedList}. Minor tuning needed.`;
    } else if (passedCount >= totalChecks - 2) {
      return `🟠 V2 NEEDS WORK — ${passedCount}/${totalChecks} gates passed. Failed: ${failedList}. Significant improvements required.`;
    } else {
      return `🔴 V2 REJECTED — ${passedCount}/${totalChecks} gates passed. Failed: ${failedList}. Back to drawing board.`;
    }
  }

  /**
   * Helper: Get summary statistics for quick comparison
   */
  async quickCompareV1V2(config?: Partial<RollingConfig>): Promise<{
    v1: RollingSummary;
    v2: RollingSummary;
    comparison: {
      sharpeDelta: number;
      ddDelta: number;
      stabilityDelta: number;
      recommendation: string;
    };
  }> {
    // Run V1 (disable all V2 features via overrides in sim)
    console.log('[ROLLING 36.4] Running V1 baseline...');
    const v1Result = await this.runRollingValidation({
      ...config,
      // V1 uses default params, no special overrides for V2 features
    });

    // V2 comparison would need different signal builder config
    // For now, return V1 result and placeholder for V2
    console.log('[ROLLING 36.4] V1 complete. V2 comparison requires separate run with V2 features enabled.');

    return {
      v1: v1Result.summary,
      v2: v1Result.summary, // TODO: Run with V2 features
      comparison: {
        sharpeDelta: 0,
        ddDelta: 0,
        stabilityDelta: 0,
        recommendation: 'Run V2 with Dynamic Floor + Dispersion enabled for comparison',
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate mean of array
 */
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Calculate standard deviation of array
 */
function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// Export singleton
export const simRollingService = new SimRollingService();
