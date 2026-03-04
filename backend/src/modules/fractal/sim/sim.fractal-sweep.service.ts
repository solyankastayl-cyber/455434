/**
 * BLOCK 34.9 — Signal Surface Sweep v2 (Fractal-Based)
 * 
 * Uses FractalSignalBuilder instead of simple momentum.
 * Varies fractal signal parameters:
 * - windowLen: [30, 60, 90]
 * - minSimilarity: [0.60, 0.65, 0.70, 0.75]
 * - minMatches: [6, 8, 10, 12]
 * - neutralBand: [0.0015, 0.002, 0.003]
 * 
 * Key principle: Uses look-ahead safe asOf filtering.
 */

import { CanonicalOhlcvModel } from '../data/schemas/fractal-canonical-ohlcv.schema.js';
import { FractalEngine } from '../engine/fractal.engine.js';
import { FractalSignalBuilder, FractalSignalParams, DEFAULT_SIGNAL_PARAMS } from '../engine/fractal.signal.builder.js';
import { FIXED_CONFIG } from './sim.oos.splits.js';

export interface FractalSweepConfig {
  windowLen: number;
  minSimilarity: number;
  minMatches: number;
  neutralBand: number;
  horizonDays: number;
  similarityMode?: 'zscore' | 'raw_returns';  // BLOCK 34.10
  // BLOCK 34.11: Relative signal params
  useRelative?: boolean;
  relativeBand?: number;
  baselineLookbackDays?: number;
}

export interface FractalSweepResult {
  windowLen: number;
  minSimilarity: number;
  minMatches: number;
  neutralBand: number;
  relativeBand?: number;    // BLOCK 34.11
  trades: number;
  sharpe: number;
  maxDD: number;
  cagr: number;
  finalEquity: number;
  winRate: number;
  avgHoldDays: number;
  avgMatchCount: number;
  pass: boolean;
  reasons: string[];
}

export interface FractalSweepSummary {
  ok: boolean;
  totalConfigs: number;
  passedConfigs: number;
  results: FractalSweepResult[];
  bestConfig: FractalSweepResult | null;
  top5: FractalSweepResult[];
  surfaceAnalysis: {
    tradesVsWindowLen: { windowLen: number; avgTrades: number }[];
    sharpeVsSimilarity: { similarity: number; avgSharpe: number }[];
    sweetSpotRegion: string;
  };
}

// Default sweep parameters for fractal-based signal
// BLOCK 34.11: Updated for relative mode
export const DEFAULT_FRACTAL_SWEEP = {
  windowLen: [30, 60],
  minSimilarity: [0.30, 0.35, 0.40],  // Lower for raw_returns
  minMatches: [4, 6, 8],
  neutralBand: [0.001, 0.002],
  relativeBand: [0.001, 0.0015, 0.002]  // BLOCK 34.11
};

// Pass thresholds - adjusted for relative mode (expect more trades)
export const FRACTAL_THRESHOLDS = {
  minTrades: 15,   // Lowered from 20
  minSharpe: 0.45,
  maxDD: 0.35,
  minWinRate: 0.50
};

export class FractalSignalSweepService {
  private engine: FractalEngine;
  private signalBuilder: FractalSignalBuilder;

  constructor() {
    this.engine = new FractalEngine();
    this.signalBuilder = new FractalSignalBuilder(this.engine);
  }

  /**
   * Run Fractal Signal Surface Sweep
   */
  async sweep(params: {
    testWindow: { from: string; to: string };
    windowLen?: number[];
    minSimilarity?: number[];
    minMatches?: number[];
    neutralBand?: number[];
    horizonDays?: number;
    stepDays?: number;
  }): Promise<FractalSweepSummary> {
    const windowLens = params.windowLen ?? DEFAULT_FRACTAL_SWEEP.windowLen;
    const similarities = params.minSimilarity ?? DEFAULT_FRACTAL_SWEEP.minSimilarity;
    const minMatchesList = params.minMatches ?? DEFAULT_FRACTAL_SWEEP.minMatches;
    const neutralBands = params.neutralBand ?? DEFAULT_FRACTAL_SWEEP.neutralBand;
    const horizonDays = params.horizonDays ?? 30;
    const stepDays = params.stepDays ?? 7;

    const totalConfigs = windowLens.length * similarities.length * minMatchesList.length * neutralBands.length;
    console.log(`[FractalSweep] Starting sweep: ${totalConfigs} configurations`);
    console.log(`[FractalSweep] Test window: ${params.testWindow.from} → ${params.testWindow.to}`);

    const results: FractalSweepResult[] = [];
    let processed = 0;

    for (const windowLen of windowLens) {
      for (const minSimilarity of similarities) {
        for (const minMatches of minMatchesList) {
          for (const neutralBand of neutralBands) {
            processed++;
            console.log(`[FractalSweep] ${processed}/${totalConfigs}: w=${windowLen}, s=${minSimilarity}, m=${minMatches}, nb=${neutralBand}`);

            try {
              const simResult = await this.runSimWithFractalSignal({
                testWindow: params.testWindow,
                config: { windowLen, minSimilarity, minMatches, neutralBand, horizonDays },
                stepDays
              });

              const reasons: string[] = [];
              let pass = true;

              if (simResult.trades < FRACTAL_THRESHOLDS.minTrades) {
                pass = false;
                reasons.push(`Trades ${simResult.trades} < ${FRACTAL_THRESHOLDS.minTrades}`);
              }
              if (simResult.sharpe < FRACTAL_THRESHOLDS.minSharpe) {
                pass = false;
                reasons.push(`Sharpe ${simResult.sharpe.toFixed(3)} < ${FRACTAL_THRESHOLDS.minSharpe}`);
              }
              if (simResult.maxDD > FRACTAL_THRESHOLDS.maxDD) {
                pass = false;
                reasons.push(`MaxDD ${(simResult.maxDD * 100).toFixed(1)}% > ${FRACTAL_THRESHOLDS.maxDD * 100}%`);
              }

              if (pass) reasons.push('All thresholds met');

              results.push({
                windowLen,
                minSimilarity,
                minMatches,
                neutralBand,
                trades: simResult.trades,
                sharpe: Math.round(simResult.sharpe * 1000) / 1000,
                maxDD: Math.round(simResult.maxDD * 10000) / 10000,
                cagr: Math.round(simResult.cagr * 10000) / 10000,
                finalEquity: Math.round(simResult.finalEquity * 10000) / 10000,
                winRate: Math.round(simResult.winRate * 1000) / 1000,
                avgHoldDays: simResult.avgHoldDays,
                avgMatchCount: simResult.avgMatchCount,
                pass,
                reasons
              });

            } catch (err) {
              console.error(`[FractalSweep] Error:`, err);
              results.push({
                windowLen, minSimilarity, minMatches, neutralBand,
                trades: 0, sharpe: 0, maxDD: 1, cagr: 0, finalEquity: 0,
                winRate: 0, avgHoldDays: 0, avgMatchCount: 0,
                pass: false,
                reasons: [err instanceof Error ? err.message : String(err)]
              });
            }
          }
        }
      }
    }

    // Rank results
    const rankedResults = [...results].sort((a, b) => {
      const scoreA = a.sharpe - (a.maxDD * 0.5) + (Math.min(a.trades, 30) / 100);
      const scoreB = b.sharpe - (b.maxDD * 0.5) + (Math.min(b.trades, 30) / 100);
      return scoreB - scoreA;
    });

    const passedConfigs = results.filter(r => r.pass).length;
    const bestConfig = rankedResults[0] || null;
    const top5 = rankedResults.slice(0, 5);

    const surfaceAnalysis = this.analyzeSurface(results, windowLens, similarities);

    console.log(`[FractalSweep] Complete: ${passedConfigs}/${totalConfigs} passed`);

    return {
      ok: true,
      totalConfigs,
      passedConfigs,
      results: rankedResults,
      bestConfig,
      top5,
      surfaceAnalysis
    };
  }

  /**
   * Run simulation with fractal signal
   */
  private async runSimWithFractalSignal(params: {
    testWindow: { from: string; to: string };
    config: FractalSweepConfig;
    stepDays: number;
  }): Promise<{
    trades: number;
    sharpe: number;
    maxDD: number;
    cagr: number;
    finalEquity: number;
    winRate: number;
    avgHoldDays: number;
    avgMatchCount: number;
  }> {
    const { testWindow, config, stepDays } = params;

    const from = new Date(testWindow.from);
    const to = new Date(testWindow.to);

    // Get all prices
    const prices = await CanonicalOhlcvModel.find({
      'meta.symbol': 'BTC',
      ts: { $gte: from, $lte: to }
    }).sort({ ts: 1 }).lean() as any[];

    if (prices.length < config.windowLen + config.horizonDays + 10) {
      throw new Error('Insufficient price data');
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
    let holdDays = 0;
    let tradePnl = 0;
    let totalMatchCount = 0;
    let signalCount = 0;
    let totalHoldDays = 0;    // Track total days in position
    const returns: number[] = [];

    // Fixed risk config — more active trading
    // BLOCK 34.11: Tuned for relative signal with faster rotation
    const softDD = FIXED_CONFIG.risk.soft;
    const hardDD = FIXED_CONFIG.risk.hard;
    const enterThr = 0.03;   // Lower threshold for more entries (was 0.05)
    const minHold = 7;       // Minimum hold in REAL days (not steps)
    const maxHold = 60;      // Maximum hold in REAL days — force exit after 2 months
    const cdDays = 0;        // No cooldown - allow immediate re-entry on opposite signal
    const roundTripCost = 2 * (4 + 6 + 2) / 10000;

    let cooldownUntil: Date | null = null;
    const actualStep = Math.max(1, stepDays);
    let realHoldDays = 0;    // Track actual days held in current trade

    // Process in steps
    for (let i = config.windowLen + 90; i < prices.length; i += actualStep) {
      const asOf = prices[i].ts as Date;
      const price = prices[i].ohlcv?.c ?? 0;
      if (!price) continue;

      // Calculate step PnL
      let stepPnl = 0;
      if (position !== 'FLAT' && lastPrice > 0) {
        const ret = price / lastPrice - 1;
        stepPnl = position === 'LONG' ? ret * posSize : -ret * posSize;
        equity *= (1 + stepPnl);
        holdDays += actualStep;
        realHoldDays += actualStep;  // Track actual days
        tradePnl += stepPnl;
      }
      returns.push(stepPnl);

      if (equity > peakEquity) peakEquity = equity;
      const currentDD = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;

      // DD-aware exposure multiplier (BLOCK 34.8 fix)
      // Only apply DD gating when in position - for entry, always allow
      let ddMult = 1.0;
      if (position !== 'FLAT') {
        if (currentDD >= hardDD) {
          ddMult = 0;
        } else if (currentDD > softDD) {
          const x = (currentDD - softDD) / (hardDD - softDD);
          ddMult = 0.15 + 0.85 * (1 - Math.pow(x, 1.5));
        }
      }

      // Get fractal signal with asOf (look-ahead safe)
      // BLOCK 34.10: Use raw_returns mode for asOf-safe simulation
      // BLOCK 34.11: Use relative signal mode
      const signal = await this.signalBuilder.build({
        symbol: 'BTC',
        timeframe: '1d',
        asOf: asOf.toISOString(),
        windowLen: config.windowLen as 30 | 60 | 90,
        topK: 25,
        minSimilarity: config.minSimilarity,
        minMatches: config.minMatches,
        horizonDays: config.horizonDays,
        minGapDays: 60,
        neutralBand: config.neutralBand,
        similarityMode: config.similarityMode ?? 'raw_returns',
        // BLOCK 34.11: Relative signal params
        useRelative: config.useRelative ?? true,
        relativeBand: config.relativeBand ?? 0.0015,
        baselineLookbackDays: config.baselineLookbackDays ?? 720  // 2 year rolling baseline
      });

      totalMatchCount += signal.matchCount;
      signalCount++;

      const inCooldown = cooldownUntil && asOf < cooldownUntil;

      // Position management
      // Hard kill
      if (currentDD >= hardDD && position !== 'FLAT') {
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        holdDays = 0;
        totalHoldDays += realHoldDays;  // Track total hold time
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * 86400000);
      }
      
      // Soft kill - reduce position but don't exit
      if (currentDD >= softDD && position !== 'FLAT' && currentDD < hardDD) {
        const reduceSize = posSize * 0.5;
        equity *= (1 - roundTripCost / 2 * reduceSize);
        posSize -= reduceSize;
      }
      
      // Max hold force exit - use realHoldDays
      if (position !== 'FLAT' && realHoldDays >= maxHold) {
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        holdDays = 0;
        totalHoldDays += realHoldDays;  // Track total hold time
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 86400000);
      }
      
      // Exit on signal flip - use realHoldDays
      if (position !== 'FLAT' && realHoldDays >= minHold) {
        const oppositeSignal = (position === 'LONG' && signal.action === 'SHORT') ||
                               (position === 'SHORT' && signal.action === 'LONG');
        const weakSignal = signal.action === 'NEUTRAL' || signal.confidence < 0.05;

        if (oppositeSignal || weakSignal) {
          equity *= (1 - roundTripCost / 2 * posSize);
          if (tradePnl > 0) tradesWon++;
          position = 'FLAT';
          posSize = 0;
          holdDays = 0;
          totalHoldDays += realHoldDays;  // Track total hold time
          realHoldDays = 0;
          tradePnl = 0;
          cooldownUntil = new Date(asOf.getTime() + cdDays * 86400000);
        }
      }
      
      // Enter - only if flat and no cooldown
      if (position === 'FLAT' && !inCooldown && ddMult > 0.01) {
        if (signal.action !== 'NEUTRAL' && signal.confidence >= enterThr) {
          // Apply DD multiplier to exposure
          const baseExposure = Math.min(2, signal.confidence * 2);
          const exposure = baseExposure * ddMult;
          if (exposure > 0.01) {
            equity *= (1 - roundTripCost / 2 * exposure);
            position = signal.action;
            posSize = exposure;
            entryPrice = price;
            holdDays = 0;
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

    let peak = 1;
    let maxDD = 0;
    let cumEquity = 1;
    for (const ret of returns) {
      cumEquity *= (1 + ret);
      if (cumEquity > peak) peak = cumEquity;
      const dd = (peak - cumEquity) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    const years = returns.length / 52;
    const cagr = years > 0 ? Math.pow(equity, 1 / years) - 1 : 0;
    const winRate = tradesOpened > 0 ? tradesWon / tradesOpened : 0;
    const avgHoldDays = tradesOpened > 0 ? totalHoldDays / tradesOpened : 0;
    const avgMatchCount = signalCount > 0 ? totalMatchCount / signalCount : 0;

    return {
      trades: tradesOpened,
      sharpe,
      maxDD,
      cagr,
      finalEquity: equity,
      winRate,
      avgHoldDays: Math.round(avgHoldDays),
      avgMatchCount: Math.round(avgMatchCount * 10) / 10
    };
  }

  private analyzeSurface(results: FractalSweepResult[], windowLens: number[], similarities: number[]) {
    const tradesVsWindowLen: { windowLen: number; avgTrades: number }[] = [];
    const sharpeVsSimilarity: { similarity: number; avgSharpe: number }[] = [];

    for (const w of windowLens) {
      const wResults = results.filter(r => r.windowLen === w);
      if (wResults.length > 0) {
        const avgTrades = wResults.reduce((a, b) => a + b.trades, 0) / wResults.length;
        tradesVsWindowLen.push({ windowLen: w, avgTrades: Math.round(avgTrades * 10) / 10 });
      }
    }

    for (const s of similarities) {
      const sResults = results.filter(r => r.minSimilarity === s);
      if (sResults.length > 0) {
        const avgSharpe = sResults.reduce((a, b) => a + b.sharpe, 0) / sResults.length;
        sharpeVsSimilarity.push({ similarity: s, avgSharpe: Math.round(avgSharpe * 1000) / 1000 });
      }
    }

    const validResults = results.filter(r => r.trades >= 20 && r.sharpe > 0);
    let sweetSpotRegion = 'No valid region found';

    if (validResults.length > 0) {
      const best = validResults.sort((a, b) => b.sharpe - a.sharpe)[0];
      sweetSpotRegion = `w=${best.windowLen}, s=${best.minSimilarity}, m=${best.minMatches}, nb=${best.neutralBand} (Sharpe=${best.sharpe}, Trades=${best.trades})`;
    }

    return { tradesVsWindowLen, sharpeVsSimilarity, sweetSpotRegion };
  }
}
