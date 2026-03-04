/**
 * BLOCK 34.17 — Full Unified Walk-Forward Test (2014-2026)
 * BLOCK 35.1 — Added trade collection for Monte Carlo
 * 
 * Single continuous run with all guards enabled:
 * - Bull SHORT Block (34.16A)
 * - Crash Guard (34.14)
 * - Bubble Guard (34.15)
 * - Relative Signal Mode (34.11)
 * - Risk Layer
 * 
 * No splits. No tuning. Reality test.
 */

import { CanonicalOhlcvModel } from '../data/schemas/fractal-canonical-ohlcv.schema.js';
import { FractalEngine } from '../engine/fractal.engine.js';
import { FractalSignalBuilder } from '../engine/fractal.signal.builder.js';
import { FIXED_CONFIG } from './sim.oos.splits.js';
import { SimOverrides, BASE_COSTS, applyCostMultiplier, getRoundTripCost } from './sim.overrides.js';
import type { SimTrade } from './sim.montecarlo.js';

export interface FullRunResult {
  ok: boolean;
  period: { start: string; end: string };
  config: typeof FIXED_CONFIG;
  metrics: {
    sharpe: number;
    cagr: number;
    maxDD: number;
    maxDDStart: string;
    maxDDEnd: string;
    maxDDDuration: number;  // days
    totalTrades: number;
    winRate: number;
    avgHoldDays: number;
    finalEquity: number;
  };
  yearlyBreakdown: YearMetrics[];
  regimeStats: {
    bullSteps: number;
    bearSteps: number;
    crashSteps: number;
    bubbleSteps: number;
  };
  equityCurve: EquityPoint[];  // sampled monthly
  trades: SimTrade[];  // BLOCK 35.1: For Monte Carlo
  verdict: string;
}

export interface YearMetrics {
  year: number;
  sharpe: number;
  maxDD: number;
  trades: number;
  endEquity: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  dd: number;
  regime: string;
}

export class SimFullService {
  private engine: FractalEngine;
  private signalBuilder: FractalSignalBuilder;

  constructor() {
    this.engine = new FractalEngine();
    this.signalBuilder = new FractalSignalBuilder(this.engine);
  }

  /**
   * Run full unified walk-forward test (BLOCK 34.17)
   * BLOCK 35.4: Added overrides param for cost multiplier stress testing
   */
  async runFull(params: {
    start?: string;
    end?: string;
    symbol?: string;
    stepDays?: number;
    overrides?: SimOverrides;  // BLOCK 35.4
  } = {}): Promise<FullRunResult> {
    const symbol = params.symbol ?? 'BTC';
    const stepDays = params.stepDays ?? 7;
    const startDate = params.start ?? '2014-01-01';
    const endDate = params.end ?? '2026-02-15';
    const overrides = params.overrides ?? {};
    
    // BLOCK 35.4: Apply cost multiplier
    const costMult = overrides.costMultiplier ?? 1.0;
    const costs = applyCostMultiplier(BASE_COSTS, costMult);
    const roundTripCost = getRoundTripCost(costs);
    
    if (costMult !== 1.0) {
      console.log(`[FULL 35.4] Cost stress test: ×${costMult} (round-trip: ${(roundTripCost * 10000).toFixed(0)} bps)`);
    }
    
    const from = new Date(startDate);
    const to = new Date(endDate);
    const cfg = FIXED_CONFIG.signal;

    console.log(`[FULL 34.17] Starting unified walk-forward: ${startDate} → ${endDate}`);

    // Get all prices with lookback
    const lookbackStart = new Date(from.getTime() - (cfg.windowLen + cfg.baselineLookbackDays + 100) * 86400000);
    const prices = await CanonicalOhlcvModel.find({
      'meta.symbol': symbol,
      ts: { $gte: lookbackStart, $lte: to }
    }).sort({ ts: 1 }).lean() as any[];

    if (prices.length < cfg.windowLen + 100) {
      throw new Error(`Insufficient price data: ${prices.length} candles`);
    }

    // Find start index
    let startIdx = 0;
    for (let i = 0; i < prices.length; i++) {
      if (new Date(prices[i].ts) >= from) {
        startIdx = i;
        break;
      }
    }

    // Simulation state
    let equity = 1.0;
    let peakEquity = 1.0;
    let position: 'FLAT' | 'LONG' | 'SHORT' = 'FLAT';
    let posSize = 0;
    let entryPrice = 0;
    let entryTs = '';  // BLOCK 35.1: Track entry timestamp
    let lastPrice = 0;
    let tradesOpened = 0;
    let tradesWon = 0;
    let realHoldDays = 0;
    let tradePnl = 0;
    let totalHoldDays = 0;
    
    // BLOCK 35.2: Consecutive Loss Guard state
    let consecutiveLosses = 0;
    let lossGuardCooldownUntil: Date | null = null;
    let lossGuardExposureMult = 1.0;
    
    // Regime counters
    let bullSteps = 0;
    let bearSteps = 0;
    let crashSteps = 0;
    let bubbleSteps = 0;

    const returns: number[] = [];
    const equityCurve: EquityPoint[] = [];
    const trades: SimTrade[] = [];  // BLOCK 35.1: Collect trades for Monte Carlo
    const yearlyData: Map<number, { returns: number[]; trades: number; startEquity: number; endEquity: number }> = new Map();

    // MaxDD tracking
    let maxDD = 0;
    let maxDDStart = '';
    let maxDDEnd = '';
    let maxDDDuration = 0;
    let ddStartDate = '';
    let currentDDDays = 0;

    // Risk params
    const softDD = FIXED_CONFIG.risk.soft;
    const hardDD = FIXED_CONFIG.risk.hard;
    const enterThr = 0.03;
    const minHold = 7;
    const maxHold = 60;
    const cdDays = 0;
    // roundTripCost now comes from BLOCK 35.4 cost model above

    let cooldownUntil: Date | null = null;
    let lastMonth = -1;

    // Process each step
    for (let i = startIdx; i < prices.length; i += stepDays) {
      const asOf = prices[i].ts as Date;
      const price = prices[i].ohlcv?.c ?? 0;
      const lowPrice = prices[i].ohlcv?.l ?? price;
      if (!price) continue;

      const year = asOf.getFullYear();
      const month = asOf.getMonth();

      // Initialize year tracking
      if (!yearlyData.has(year)) {
        yearlyData.set(year, { returns: [], trades: 0, startEquity: equity, endEquity: equity });
      }

      // Position-level stop-loss check
      const positionStopLoss = 0.15;
      let hitStopLoss = false;
      if (position === 'LONG' && entryPrice > 0 && lowPrice > 0) {
        const priceDrop = (entryPrice - lowPrice) / entryPrice;
        if (priceDrop >= positionStopLoss) {
          hitStopLoss = true;
          const stopPrice = entryPrice * (1 - positionStopLoss);
          const stopRet = lastPrice > 0 ? stopPrice / lastPrice - 1 : 0;
          const stopPnl = stopRet * posSize;
          equity *= (1 + stopPnl);
          realHoldDays += stepDays;
          tradePnl += stopPnl;
          returns.push(stopPnl);
          yearlyData.get(year)!.returns.push(stopPnl);
          
          // BLOCK 35.1: Record stop-loss trade
          const grossReturn = (stopPrice / entryPrice - 1);
          const netReturn = grossReturn - roundTripCost;
          trades.push({
            entryTs,
            exitTs: asOf.toISOString(),
            side: 'LONG',
            entryPrice,
            exitPrice: stopPrice,
            netReturn
          });
          
          equity *= (1 - roundTripCost / 2 * posSize);
          position = 'FLAT';
          posSize = 0;
          totalHoldDays += realHoldDays;
          realHoldDays = 0;
          tradePnl = 0;
          cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * 86400000);
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
      yearlyData.get(year)!.returns.push(stepPnl);

      // Update peak and DD
      if (equity > peakEquity) {
        peakEquity = equity;
        ddStartDate = '';
        currentDDDays = 0;
      }
      const currentDD = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
      
      if (currentDD > 0 && !ddStartDate) {
        ddStartDate = asOf.toISOString().slice(0, 10);
      }
      if (currentDD > 0) {
        currentDDDays += stepDays;
      }
      
      if (currentDD > maxDD) {
        maxDD = currentDD;
        maxDDStart = ddStartDate || asOf.toISOString().slice(0, 10);
        maxDDEnd = asOf.toISOString().slice(0, 10);
        maxDDDuration = currentDDDays;
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

      // Get signal
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

      // Count regime steps
      if (signal.meta?.structuralBull) bullSteps++;
      if (signal.meta?.structuralBear) bearSteps++;
      if (signal.meta?.crashTransition) crashSteps++;
      if (signal.meta?.bubble) bubbleSteps++;

      const inCooldown = cooldownUntil && asOf < cooldownUntil;
      
      // BLOCK 35.2: Check if loss guard cooldown ended
      if (lossGuardCooldownUntil && asOf >= lossGuardCooldownUntil) {
        lossGuardCooldownUntil = null;
        lossGuardExposureMult = 0.5;  // Come back at reduced exposure
        consecutiveLosses = 2;  // Pretend we had 2 losses to stay cautious
      }
      const inLossGuardCooldown = lossGuardCooldownUntil && asOf < lossGuardCooldownUntil;

      // Helper to record trade on exit (BLOCK 35.1) + update loss guard (BLOCK 35.2)
      const recordTrade = (exitPrice: number, side: 'LONG' | 'SHORT') => {
        const grossReturn = side === 'LONG' 
          ? (exitPrice / entryPrice - 1) 
          : (entryPrice / exitPrice - 1);
        const netReturn = grossReturn - roundTripCost;
        trades.push({
          entryTs,
          exitTs: asOf.toISOString(),
          side,
          entryPrice,
          exitPrice,
          netReturn
        });
        
        // BLOCK 35.2: Update consecutive loss state (softened thresholds)
        if (netReturn < 0) {
          consecutiveLosses++;
          if (consecutiveLosses >= 4) {
            lossGuardExposureMult = 0.5;  // Reduce to 50% after 4 losses
          }
          if (consecutiveLosses >= 5) {
            lossGuardCooldownUntil = new Date(asOf.getTime() + 14 * 86400000);  // 14 day cooldown after 5
            lossGuardExposureMult = 0.25;  // Very reduced, but not zero
          }
        } else {
          // Win resets consecutive losses, gradually restore exposure
          if (consecutiveLosses > 0) {
            consecutiveLosses = Math.max(0, consecutiveLosses - 2);  // Faster recovery on win
          }
          if (consecutiveLosses === 0) {
            lossGuardExposureMult = 1.0;  // Full exposure restored
          } else if (consecutiveLosses <= 2) {
            lossGuardExposureMult = 0.75;  // Partial recovery
          }
        }
      };

      // 34.16A: Bull Trend SHORT Block - Force Exit
      if (position === 'SHORT' && signal.meta?.structuralBull === true) {
        recordTrade(price, 'SHORT');
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 86400000);
      }

      // 34.15: Bubble Guard - Force Exit
      if (position !== 'FLAT' && signal.meta?.bubble === true) {
        recordTrade(price, position as 'LONG' | 'SHORT');
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * 86400000);
      }

      // 34.14: Crash Guard - Force Exit LONG
      if (position === 'LONG' && signal.meta?.crashTransition === true) {
        recordTrade(price, 'LONG');
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * 86400000);
      }

      // Hard kill
      if (currentDD >= hardDD && position !== 'FLAT') {
        recordTrade(price, position as 'LONG' | 'SHORT');
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * 86400000);
      }
      
      // Soft kill
      if (currentDD >= softDD && position !== 'FLAT' && currentDD < hardDD) {
        const reduceSize = posSize * 0.5;
        equity *= (1 - roundTripCost / 2 * reduceSize);
        posSize -= reduceSize;
      }
      
      // Max hold force exit
      if (position !== 'FLAT' && realHoldDays >= maxHold) {
        recordTrade(price, position as 'LONG' | 'SHORT');
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 86400000);
      }

      // Exit on signal flip
      if (position !== 'FLAT' && realHoldDays >= minHold) {
        const oppositeSignal = (position === 'LONG' && signal.action === 'SHORT') ||
                               (position === 'SHORT' && signal.action === 'LONG');
        const weakSignal = signal.action === 'NEUTRAL' || signal.confidence < 0.05;

        if (oppositeSignal || weakSignal) {
          recordTrade(price, position as 'LONG' | 'SHORT');
          equity *= (1 - roundTripCost / 2 * posSize);
          if (tradePnl > 0) tradesWon++;
          position = 'FLAT';
          posSize = 0;
          totalHoldDays += realHoldDays;
          realHoldDays = 0;
          tradePnl = 0;
          cooldownUntil = new Date(asOf.getTime() + cdDays * 86400000);
        }
      }
      
      // Enter (with BLOCK 35.2 loss guard)
      if (position === 'FLAT' && !inCooldown && !inLossGuardCooldown && ddMult > 0.01) {
        if (signal.action !== 'NEUTRAL' && signal.confidence >= enterThr) {
          const baseExposure = Math.min(2, signal.confidence * 2);
          // BLOCK 35.2: Apply loss guard exposure multiplier
          const exposure = baseExposure * ddMult * lossGuardExposureMult;
          if (exposure > 0.01) {
            equity *= (1 - roundTripCost / 2 * exposure);
            position = signal.action;
            posSize = exposure;
            entryPrice = price;
            entryTs = asOf.toISOString();  // BLOCK 35.1: Record entry timestamp
            realHoldDays = 0;
            tradePnl = 0;
            tradesOpened++;
            yearlyData.get(year)!.trades++;
          }
        }
      }

      lastPrice = price;
      yearlyData.get(year)!.endEquity = equity;

      // Sample equity curve monthly
      if (month !== lastMonth) {
        let regimeStr = 'NEUTRAL';
        if (signal.meta?.structuralBull) regimeStr = 'BULL';
        else if (signal.meta?.structuralBear) regimeStr = 'BEAR';
        else if (signal.meta?.crashTransition) regimeStr = 'CRASH';
        
        equityCurve.push({
          date: asOf.toISOString().slice(0, 10),
          equity: Math.round(equity * 10000) / 10000,
          dd: Math.round(currentDD * 10000) / 10000,
          regime: regimeStr
        });
        lastMonth = month;
      }
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
    const avgHoldDays = tradesOpened > 0 ? totalHoldDays / tradesOpened : 0;

    // Build yearly breakdown
    const yearlyBreakdown: YearMetrics[] = [];
    for (const [yr, data] of yearlyData) {
      const yMean = data.returns.length ? data.returns.reduce((a, b) => a + b, 0) / data.returns.length : 0;
      const yVar = data.returns.length > 1
        ? data.returns.reduce((a, b) => a + (b - yMean) ** 2, 0) / (data.returns.length - 1)
        : 0;
      const yVol = Math.sqrt(yVar);
      const ySharpe = yVol > 0 ? (yMean * Math.sqrt(52)) / yVol : 0;

      let yPeak = data.startEquity;
      let yMaxDD = 0;
      let yEq = data.startEquity;
      for (const r of data.returns) {
        yEq *= (1 + r);
        if (yEq > yPeak) yPeak = yEq;
        const dd = (yPeak - yEq) / yPeak;
        if (dd > yMaxDD) yMaxDD = dd;
      }

      yearlyBreakdown.push({
        year: yr,
        sharpe: Math.round(ySharpe * 1000) / 1000,
        maxDD: Math.round(yMaxDD * 10000) / 10000,
        trades: data.trades,
        endEquity: Math.round(data.endEquity * 10000) / 10000
      });
    }
    yearlyBreakdown.sort((a, b) => a.year - b.year);

    // Verdict
    let verdict = '';
    if (sharpe >= 0.55 && maxDD <= 0.35 && tradesOpened >= 40) {
      verdict = '✅ PRODUCTION READY — v1 Stable candidate';
    } else if (sharpe >= 0.4 && maxDD <= 0.40) {
      verdict = '🟡 ACCEPTABLE — Minor refinements possible';
    } else {
      verdict = '🔴 NEEDS WORK — Structural issues remain';
    }

    console.log(`[FULL 34.17] Complete: Sharpe=${sharpe.toFixed(3)}, MaxDD=${(maxDD*100).toFixed(1)}%, Trades=${tradesOpened}, TradeLog=${trades.length}`);

    return {
      ok: true,
      period: { start: startDate, end: endDate },
      config: FIXED_CONFIG,
      metrics: {
        sharpe: Math.round(sharpe * 1000) / 1000,
        cagr: Math.round(cagr * 10000) / 10000,
        maxDD: Math.round(maxDD * 10000) / 10000,
        maxDDStart,
        maxDDEnd,
        maxDDDuration,
        totalTrades: tradesOpened,
        winRate: Math.round(winRate * 1000) / 1000,
        avgHoldDays: Math.round(avgHoldDays),
        finalEquity: Math.round(equity * 10000) / 10000
      },
      yearlyBreakdown,
      regimeStats: {
        bullSteps,
        bearSteps,
        crashSteps,
        bubbleSteps
      },
      equityCurve,
      trades,  // BLOCK 35.1: For Monte Carlo
      verdict
    };
  }
}
