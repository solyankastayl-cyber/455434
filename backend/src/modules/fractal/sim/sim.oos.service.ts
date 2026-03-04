/**
 * BLOCK 34.12 — OOS Final Robustness Gate
 * 
 * Runs the FIXED v1 configuration across 4 independent
 * time windows covering different market regimes.
 * 
 * Key principle: NO parameter tuning during OOS.
 * We test the exact v1 config found during optimization.
 * Uses FractalSignalBuilder with raw_returns + relative mode.
 */

import { CanonicalOhlcvModel } from '../data/schemas/fractal-canonical-ohlcv.schema.js';
import { FractalEngine } from '../engine/fractal.engine.js';
import { FractalSignalBuilder } from '../engine/fractal.signal.builder.js';
import { OOS_SPLITS, FIXED_CONFIG, OOS_THRESHOLDS, OOSSplit } from './sim.oos.splits.js';

export interface OOSRowResult {
  split: string;
  regime: string;
  testFrom: string;
  testTo: string;
  sharpe: number;
  maxDD: number;
  finalEquity: number;
  cagr: number;
  trades: number;
  winRate: number;
  avgHoldDays: number;
  avgMatchCount: number;
  warnings: string[];
  bearSteps?: number;  // BLOCK 34.13: Steps in structural bear regime
}

export interface OOSVerdict {
  split: string;
  pass: boolean;
  reasons: string[];
}

export interface OOSValidationResult {
  ok: boolean;
  v1Config: typeof FIXED_CONFIG;
  thresholds: typeof OOS_THRESHOLDS;
  rows: OOSRowResult[];
  verdict: OOSVerdict[];
  passCount: number;
  totalSplits: number;
  overallPass: boolean;
  worstSharpe: number;
  recommendation: string;
}

export class SimOosService {
  private engine: FractalEngine;
  private signalBuilder: FractalSignalBuilder;

  constructor() {
    this.engine = new FractalEngine();
    this.signalBuilder = new FractalSignalBuilder(this.engine);
  }

  /**
   * Run OOS Robustness Gate Validation (BLOCK 34.12)
   * 
   * @param params.symbol - Asset to test (default: BTC)
   * @param params.stepDays - Simulation step size (default: 7)
   */
  async runOos(params: {
    symbol?: string;
    stepDays?: number;
  } = {}): Promise<OOSValidationResult> {
    const symbol = params.symbol ?? 'BTC';
    const stepDays = params.stepDays ?? 7;

    const rows: OOSRowResult[] = [];
    const verdict: OOSVerdict[] = [];

    console.log(`[OOS 34.12] Starting Final Robustness Gate for ${symbol}`);
    console.log(`[OOS 34.12] Fixed v1 config:`, JSON.stringify(FIXED_CONFIG.signal));

    for (const split of OOS_SPLITS) {
      console.log(`[OOS] Running split: ${split.name} (${split.regime})`);
      console.log(`[OOS]   Train: ${split.train[0]} → ${split.train[1]}`);
      console.log(`[OOS]   Test:  ${split.test[0]} → ${split.test[1]}`);

      try {
        const result = await this.runSplitSimulation(symbol, split, stepDays);
        rows.push(result);

        // Evaluate pass/fail with proper scaling
        const testYears = this.getYearsBetween(split.test[0], split.test[1]);
        const minTradesForPeriod = Math.max(OOS_THRESHOLDS.minTrades, Math.round(testYears * OOS_THRESHOLDS.minTradesPerYear));
        
        const reasons: string[] = [];
        let pass = true;

        if (result.sharpe < OOS_THRESHOLDS.minSharpe) {
          pass = false;
          reasons.push(`Sharpe ${result.sharpe} < ${OOS_THRESHOLDS.minSharpe}`);
        }

        if (result.maxDD > OOS_THRESHOLDS.maxDD) {
          pass = false;
          reasons.push(`MaxDD ${(result.maxDD * 100).toFixed(1)}% > ${OOS_THRESHOLDS.maxDD * 100}%`);
        }

        if (result.trades < minTradesForPeriod) {
          pass = false;
          reasons.push(`Trades ${result.trades} < ${minTradesForPeriod} (${testYears.toFixed(1)} years)`);
        }

        if (pass) {
          reasons.push('All thresholds met');
        }

        verdict.push({
          split: split.name,
          pass,
          reasons
        });

        console.log(`[OOS] ${split.name}: Sharpe=${result.sharpe}, MaxDD=${(result.maxDD * 100).toFixed(1)}%, Trades=${result.trades}, BearSteps=${result.bearSteps || 0} → ${pass ? '✅ PASS' : '❌ FAIL'}`);

      } catch (err) {
        console.error(`[OOS] Exception in split ${split.name}:`, err);
        rows.push({
          split: split.name,
          regime: split.regime,
          testFrom: split.test[0],
          testTo: split.test[1],
          sharpe: 0,
          maxDD: 1,
          finalEquity: 0,
          cagr: 0,
          trades: 0,
          winRate: 0,
          avgHoldDays: 0,
          avgMatchCount: 0,
          warnings: [err instanceof Error ? err.message : String(err)]
        });
        verdict.push({
          split: split.name,
          pass: false,
          reasons: ['Exception: ' + (err instanceof Error ? err.message : String(err))]
        });
      }
    }

    const passCount = verdict.filter(v => v.pass).length;
    const totalSplits = OOS_SPLITS.length;
    const worstSharpe = Math.min(...rows.map(r => r.sharpe));
    
    // BLOCK 34.12.3: Overall pass requires 3/4 AND no catastrophic failure
    const hasCatastrophicFailure = rows.some(r => 
      r.sharpe < OOS_THRESHOLDS.worstSharpeFloor && r.trades >= 15
    );
    const overallPass = passCount >= OOS_THRESHOLDS.minPassSplits && !hasCatastrophicFailure;

    let recommendation = '';
    if (overallPass) {
      recommendation = `✅ OOS ROBUSTNESS GATE PASSED (${passCount}/${totalSplits}). v1 config is production-ready. Proceed to BLOCK 34.13.`;
    } else if (hasCatastrophicFailure) {
      const catastrophicSplits = rows.filter(r => r.sharpe < OOS_THRESHOLDS.worstSharpeFloor && r.trades >= 15);
      recommendation = `❌ OOS FAILED — Catastrophic failure in: ${catastrophicSplits.map(s => s.split).join(', ')}. Sharpe < ${OOS_THRESHOLDS.worstSharpeFloor}. Consider regime-gating.`;
    } else {
      const failedSplits = verdict.filter(v => !v.pass).map(v => v.split);
      recommendation = `❌ OOS FAILED (${passCount}/${totalSplits}). Failed: ${failedSplits.join(', ')}. Consider: 1) regime-gate in SIDEWAYS_LOWVOL, 2) adaptive horizon (14/30).`;
    }

    console.log(`[OOS 34.12] Validation complete: ${passCount}/${totalSplits} passed`);
    console.log(`[OOS 34.12] ${recommendation}`);

    return {
      ok: true,
      v1Config: FIXED_CONFIG,
      thresholds: OOS_THRESHOLDS,
      rows,
      verdict,
      passCount,
      totalSplits,
      overallPass,
      worstSharpe,
      recommendation
    };
  }

  /**
   * Run simulation for a single OOS split using FractalSignalBuilder
   */
  private async runSplitSimulation(
    symbol: string, 
    split: OOSSplit, 
    stepDays: number
  ): Promise<OOSRowResult> {
    const from = new Date(split.test[0]);
    const to = new Date(split.test[1]);
    const cfg = FIXED_CONFIG.signal;

    // Get all prices for test window (need extra window for signal lookback)
    const lookbackStart = new Date(from.getTime() - (cfg.windowLen + cfg.baselineLookbackDays + 100) * 86400000);
    const prices = await CanonicalOhlcvModel.find({
      'meta.symbol': symbol,
      ts: { $gte: lookbackStart, $lte: to }
    }).sort({ ts: 1 }).lean() as any[];

    if (prices.length < cfg.windowLen + 100) {
      throw new Error(`Insufficient price data for ${split.name}: ${prices.length} candles`);
    }

    // Find index of test start
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
    let lastPrice = 0;
    let tradesOpened = 0;
    let tradesWon = 0;
    let realHoldDays = 0;
    let tradePnl = 0;
    let totalMatchCount = 0;
    let signalCount = 0;
    let totalHoldDays = 0;
    let bearSteps = 0;  // BLOCK 34.13: Track structural bear steps
    const returns: number[] = [];
    const warnings: string[] = [];

    // Risk params from v1 config
    const softDD = FIXED_CONFIG.risk.soft;
    const hardDD = FIXED_CONFIG.risk.hard;
    const enterThr = 0.03;
    const minHold = 7;
    const maxHold = 60;
    const cdDays = 0;
    const roundTripCost = 2 * (4 + 6 + 2) / 10000;

    let cooldownUntil: Date | null = null;

    // Process each step in test window
    for (let i = startIdx; i < prices.length; i += stepDays) {
      const asOf = prices[i].ts as Date;
      const price = prices[i].ohlcv?.c ?? 0;
      const lowPrice = prices[i].ohlcv?.l ?? price;  // BLOCK 34.14.5: Use low for stop-loss
      if (!price) continue;

      // ============================================================
      // BLOCK 34.14.5: Intra-bar Stop-Loss Check (BEFORE P&L calc)
      // Check if low price hit stop-loss during this bar
      // ============================================================
      const positionStopLoss = 0.15;  // 15% stop-loss
      let hitStopLoss = false;
      if (position === 'LONG' && entryPrice > 0 && lowPrice > 0) {
        const priceDrop = (entryPrice - lowPrice) / entryPrice;
        if (priceDrop >= positionStopLoss) {
          hitStopLoss = true;
          // Exit at stop-loss price, not at close
          const stopPrice = entryPrice * (1 - positionStopLoss);
          const stopRet = lastPrice > 0 ? stopPrice / lastPrice - 1 : 0;
          const stopPnl = stopRet * posSize;
          equity *= (1 + stopPnl);
          realHoldDays += stepDays;
          tradePnl += stopPnl;
          returns.push(stopPnl);
          
          // Exit position
          equity *= (1 - roundTripCost / 2 * posSize);
          position = 'FLAT';
          posSize = 0;
          totalHoldDays += realHoldDays;
          realHoldDays = 0;
          tradePnl = 0;
          cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * 86400000);
          lastPrice = price;
          continue;  // Skip rest of iteration
        }
      }

      // Calculate step PnL (only if no stop-loss hit)
      let stepPnl = 0;
      if (position !== 'FLAT' && lastPrice > 0) {
        const ret = price / lastPrice - 1;
        stepPnl = position === 'LONG' ? ret * posSize : -ret * posSize;
        equity *= (1 + stepPnl);
        realHoldDays += stepDays;
        tradePnl += stepPnl;
      }
      returns.push(stepPnl);

      if (equity > peakEquity) peakEquity = equity;
      const currentDD = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;

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

      // Get fractal signal with v1 config (asOf-safe)
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

      totalMatchCount += signal.matchCount;
      signalCount++;

      // BLOCK 34.13: Track structural bear regime stats
      if (signal.regime === 'STRUCTURAL_BEAR') {
        bearSteps++;
      }
      // BLOCK 34.14: Track crash transition steps
      if (signal.meta?.crashTransition) {
        bearSteps++;  // Count crash transitions as bear steps too
      }

      const inCooldown = cooldownUntil && asOf < cooldownUntil;

      // Position management — same logic as sweep service

      // ============================================================
      // BLOCK 34.16A: Bull Trend SHORT Block - Force Exit SHORT
      // If structuralBull detected and we're in SHORT → immediate exit
      // "No shorting the rally" - prevents accumulating losses in bull market
      // ============================================================
      if (position === 'SHORT' && signal.meta?.structuralBull === true) {
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 86400000);
        // Note: No new SHORT will be entered because signal.action set to NEUTRAL in builder
      }

      // ============================================================
      // BLOCK 34.15: Bubble Top Guard - Force Exit ALL positions
      // If bubble detected (price >= 2.6x MA200) → exit any position
      // Shorting a bubble is dangerous (can squeeze), holding LONG is risky (crash imminent)
      // ============================================================
      if (position !== 'FLAT' && signal.meta?.bubble === true) {
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * 86400000); // Extended cooldown
      }

      // ============================================================
      // BLOCK 34.14.4: Crash Kill-Switch - Force Exit LONG
      // If crashTransition detected and we're in LONG → immediate exit
      // This bypasses minHold to protect capital during market crashes
      // ============================================================
      if (position === 'LONG' && signal.meta?.crashTransition === true) {
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * 86400000); // Extended cooldown
        // Note: No new LONG will be entered because signal.action already set to NEUTRAL
      }

      // Hard kill
      if (currentDD >= hardDD && position !== 'FLAT') {
        equity *= (1 - roundTripCost / 2 * posSize);
        if (tradePnl > 0) tradesWon++;
        position = 'FLAT';
        posSize = 0;
        totalHoldDays += realHoldDays;
        realHoldDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * 86400000);
      }
      
      // Soft kill - reduce position
      if (currentDD >= softDD && position !== 'FLAT' && currentDD < hardDD) {
        const reduceSize = posSize * 0.5;
        equity *= (1 - roundTripCost / 2 * reduceSize);
        posSize -= reduceSize;
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
        cooldownUntil = new Date(asOf.getTime() + cdDays * 86400000);
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
          cooldownUntil = new Date(asOf.getTime() + cdDays * 86400000);
        }
      }
      
      // Enter
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
      split: split.name,
      regime: split.regime,
      testFrom: split.test[0],
      testTo: split.test[1],
      sharpe: Math.round(sharpe * 1000) / 1000,
      maxDD: Math.round(maxDD * 10000) / 10000,
      finalEquity: Math.round(equity * 10000) / 10000,
      cagr: Math.round(cagr * 10000) / 10000,
      trades: tradesOpened,
      winRate: Math.round(winRate * 1000) / 1000,
      avgHoldDays: Math.round(avgHoldDays),
      avgMatchCount: Math.round(avgMatchCount * 10) / 10,
      warnings,
      bearSteps  // BLOCK 34.13
    };
  }

  private getYearsBetween(from: string, to: string): number {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    return (toDate.getTime() - fromDate.getTime()) / (365.25 * 86400000);
  }
}
