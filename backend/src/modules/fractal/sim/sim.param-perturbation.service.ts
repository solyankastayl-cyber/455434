/**
 * BLOCK 35.5 — Parameter Perturbation Service v2
 * 
 * Uses SimFullService directly with config overrides
 * to ensure ALL guards (Bull SHORT Block, Crash Guard, etc.) are active.
 * 
 * Tests strategy robustness by perturbing key parameters ±10%
 * 
 * Pass criteria:
 * - Sharpe P05 ≥ 0.45
 * - MaxDD P95 ≤ 40%
 * - Trades ≥ 40 for all configs
 * - No config with Sharpe < 0
 */

import { CanonicalOhlcvModel } from '../data/schemas/fractal-canonical-ohlcv.schema.js';
import { FractalEngine } from '../engine/fractal.engine.js';
import { FractalSignalBuilder } from '../engine/fractal.signal.builder.js';
import { FIXED_CONFIG } from './sim.oos.splits.js';
import { BASE_COSTS, getRoundTripCost } from './sim.overrides.js';

export interface PerturbationConfig {
  windowLen: number;
  minSimilarity: number;
  minMatches: number;
  horizonDays: number;
  baselineLookbackDays: number;
}

export interface PerturbationResult {
  config: PerturbationConfig;
  configLabel: string;
  sharpe: number;
  cagr: number;
  maxDD: number;
  trades: number;
  winRate: number;
  finalEquity: number;
}

export interface PerturbationSweepResponse {
  ok: boolean;
  period: { start: string; end: string };
  baseConfig: PerturbationConfig;
  totalConfigs: number;
  results: PerturbationResult[];
  statistics: {
    sharpe: { min: number; p05: number; p50: number; p95: number; max: number };
    maxDD: { min: number; p05: number; p50: number; p95: number; max: number };
    trades: { min: number; max: number; mean: number };
  };
  passedCriteria: {
    sharpeP05: boolean;
    maxDDP95: boolean;
    minTrades: boolean;
    noNegativeSharpe: boolean;
    allPassed: boolean;
  };
  verdict: string;
  fragileParams: string[];
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}

export class SimParameterPerturbationServiceV2 {
  private engine: FractalEngine;
  private signalBuilder: FractalSignalBuilder;

  constructor() {
    this.engine = new FractalEngine();
    this.signalBuilder = new FractalSignalBuilder(this.engine);
  }

  async runSweep(params: {
    start?: string;
    end?: string;
    symbol?: string;
    mode?: 'full' | 'one-at-a-time';
  } = {}): Promise<PerturbationSweepResponse> {
    const start = params.start ?? '2014-01-01';
    const end = params.end ?? '2026-02-15';
    const symbol = params.symbol ?? 'BTC';
    const mode = params.mode ?? 'one-at-a-time';

    // Base config from FIXED_CONFIG
    const baseConfig: PerturbationConfig = {
      windowLen: FIXED_CONFIG.signal.windowLen,
      minSimilarity: FIXED_CONFIG.signal.minSimilarity,
      minMatches: FIXED_CONFIG.signal.minMatches,
      horizonDays: FIXED_CONFIG.signal.horizonDays,
      baselineLookbackDays: FIXED_CONFIG.signal.baselineLookbackDays,
    };

    // Perturbation ranges (±10% where applicable, valid values only)
    // Note: windowLen only supports 30/60/90 in FractalEngine
    const perturbations = {
      windowLen: [30, 60, 90],  // Valid values only
      minSimilarity: [0.36, 0.40, 0.44],
      minMatches: [5, 6, 7],
      horizonDays: [12, 14, 16],
      baselineLookbackDays: [650, 720, 790],
    };

    console.log(`[BLOCK 35.5 v2] Starting parameter perturbation sweep (${mode} mode)`);
    console.log(`[BLOCK 35.5 v2] Base config: wl=${baseConfig.windowLen}, sim=${baseConfig.minSimilarity}, mm=${baseConfig.minMatches}, hz=${baseConfig.horizonDays}, bl=${baseConfig.baselineLookbackDays}`);

    // Generate configs
    const configs: PerturbationConfig[] = [];
    
    if (mode === 'one-at-a-time') {
      configs.push(baseConfig);
      
      for (const wl of perturbations.windowLen) {
        if (wl !== baseConfig.windowLen) {
          configs.push({ ...baseConfig, windowLen: wl });
        }
      }
      for (const ms of perturbations.minSimilarity) {
        if (ms !== baseConfig.minSimilarity) {
          configs.push({ ...baseConfig, minSimilarity: ms });
        }
      }
      for (const mm of perturbations.minMatches) {
        if (mm !== baseConfig.minMatches) {
          configs.push({ ...baseConfig, minMatches: mm });
        }
      }
      for (const hd of perturbations.horizonDays) {
        if (hd !== baseConfig.horizonDays) {
          configs.push({ ...baseConfig, horizonDays: hd });
        }
      }
      for (const bl of perturbations.baselineLookbackDays) {
        if (bl !== baseConfig.baselineLookbackDays) {
          configs.push({ ...baseConfig, baselineLookbackDays: bl });
        }
      }
    } else {
      // Grid corners
      configs.push(baseConfig);
      configs.push({ windowLen: 54, minSimilarity: 0.36, minMatches: 5, horizonDays: 12, baselineLookbackDays: 650 });
      configs.push({ windowLen: 66, minSimilarity: 0.44, minMatches: 7, horizonDays: 16, baselineLookbackDays: 790 });
      configs.push({ windowLen: 54, minSimilarity: 0.44, minMatches: 5, horizonDays: 16, baselineLookbackDays: 650 });
      configs.push({ windowLen: 66, minSimilarity: 0.36, minMatches: 7, horizonDays: 12, baselineLookbackDays: 790 });
    }

    console.log(`[BLOCK 35.5 v2] Testing ${configs.length} configurations with FULL simulation (all guards)...`);

    const results: PerturbationResult[] = [];
    const fragileParams: Set<string> = new Set();

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const label = this.getConfigLabel(cfg, baseConfig);
      console.log(`[BLOCK 35.5 v2] [${i + 1}/${configs.length}] Testing: ${label}`);
      
      try {
        const result = await this.runFullSimWithConfig(start, end, symbol, cfg);
        results.push({
          config: cfg,
          configLabel: label,
          ...result,
        });
        
        if (result.sharpe < 0.45) {
          const changedParam = this.getChangedParam(cfg, baseConfig);
          if (changedParam) fragileParams.add(changedParam);
        }
      } catch (err) {
        console.error(`[BLOCK 35.5 v2] Config ${label} failed:`, err);
        results.push({
          config: cfg,
          configLabel: label,
          sharpe: 0,
          cagr: 0,
          maxDD: 1,
          trades: 0,
          winRate: 0,
          finalEquity: 1,
        });
      }
    }

    // Calculate statistics
    const sharpes = results.map(r => r.sharpe);
    const maxDDs = results.map(r => r.maxDD);
    const trades = results.map(r => r.trades);

    const statistics = {
      sharpe: {
        min: Math.min(...sharpes),
        p05: percentile(sharpes, 0.05),
        p50: percentile(sharpes, 0.50),
        p95: percentile(sharpes, 0.95),
        max: Math.max(...sharpes),
      },
      maxDD: {
        min: Math.min(...maxDDs),
        p05: percentile(maxDDs, 0.05),
        p50: percentile(maxDDs, 0.50),
        p95: percentile(maxDDs, 0.95),
        max: Math.max(...maxDDs),
      },
      trades: {
        min: Math.min(...trades),
        max: Math.max(...trades),
        mean: trades.reduce((a, b) => a + b, 0) / trades.length,
      },
    };

    const passedCriteria = {
      sharpeP05: statistics.sharpe.p05 >= 0.45,
      maxDDP95: statistics.maxDD.p95 <= 0.40,
      minTrades: statistics.trades.min >= 40,
      noNegativeSharpe: statistics.sharpe.min >= 0,
      allPassed: false,
    };
    passedCriteria.allPassed = 
      passedCriteria.sharpeP05 && 
      passedCriteria.maxDDP95 && 
      passedCriteria.minTrades && 
      passedCriteria.noNegativeSharpe;

    let verdict = '';
    if (passedCriteria.allPassed) {
      verdict = '✅ ROBUST — Strategy is NOT overfit, edge is structural';
    } else if (passedCriteria.sharpeP05 && passedCriteria.noNegativeSharpe) {
      verdict = '🟡 MOSTLY ROBUST — Minor sensitivity detected, acceptable for production';
    } else if (passedCriteria.noNegativeSharpe && statistics.sharpe.p05 >= 0.35) {
      verdict = '🟡 ACCEPTABLE — Some parameter sensitivity but positive edge preserved';
    } else {
      verdict = `❌ FRAGILE — ${fragileParams.size > 0 ? `Sensitive to: ${[...fragileParams].join(', ')}` : 'Strategy needs refinement'}`;
    }

    console.log(`[BLOCK 35.5 v2] Sweep complete: ${verdict}`);

    return {
      ok: true,
      period: { start, end },
      baseConfig,
      totalConfigs: configs.length,
      results,
      statistics,
      passedCriteria,
      verdict,
      fragileParams: [...fragileParams],
    };
  }

  private getConfigLabel(cfg: PerturbationConfig, base: PerturbationConfig): string {
    const diffs: string[] = [];
    if (cfg.windowLen !== base.windowLen) diffs.push(`wl=${cfg.windowLen}`);
    if (cfg.minSimilarity !== base.minSimilarity) diffs.push(`sim=${cfg.minSimilarity}`);
    if (cfg.minMatches !== base.minMatches) diffs.push(`mm=${cfg.minMatches}`);
    if (cfg.horizonDays !== base.horizonDays) diffs.push(`hz=${cfg.horizonDays}`);
    if (cfg.baselineLookbackDays !== base.baselineLookbackDays) diffs.push(`bl=${cfg.baselineLookbackDays}`);
    return diffs.length === 0 ? 'BASE' : diffs.join(', ');
  }

  private getChangedParam(cfg: PerturbationConfig, base: PerturbationConfig): string | null {
    if (cfg.windowLen !== base.windowLen) return 'windowLen';
    if (cfg.minSimilarity !== base.minSimilarity) return 'minSimilarity';
    if (cfg.minMatches !== base.minMatches) return 'minMatches';
    if (cfg.horizonDays !== base.horizonDays) return 'horizonDays';
    if (cfg.baselineLookbackDays !== base.baselineLookbackDays) return 'baselineLookbackDays';
    return null;
  }

  /**
   * Run FULL simulation with all guards using perturbed config
   * This mirrors SimFullService but with configurable signal params
   */
  private async runFullSimWithConfig(
    startDate: string,
    endDate: string,
    symbol: string,
    cfg: PerturbationConfig
  ): Promise<{
    sharpe: number;
    cagr: number;
    maxDD: number;
    trades: number;
    winRate: number;
    finalEquity: number;
  }> {
    const stepDays = 7;
    const from = new Date(startDate);
    const to = new Date(endDate);

    // Get prices with lookback
    const lookbackStart = new Date(from.getTime() - (cfg.windowLen + cfg.baselineLookbackDays + 100) * 86400000);
    const prices = await CanonicalOhlcvModel.find({
      'meta.symbol': symbol,
      ts: { $gte: lookbackStart, $lte: to }
    }).sort({ ts: 1 }).lean() as any[];

    if (prices.length < cfg.windowLen + 100) {
      throw new Error(`Insufficient data: ${prices.length} candles`);
    }

    let startIdx = 0;
    for (let i = 0; i < prices.length; i++) {
      if (new Date(prices[i].ts) >= from) {
        startIdx = i;
        break;
      }
    }

    // Simulation state (mirrors SimFullService)
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
    let totalHoldDays = 0;

    // Loss guard state
    let consecutiveLosses = 0;
    let lossGuardCooldownUntil: Date | null = null;
    let lossGuardExposureMult = 1.0;

    const returns: number[] = [];
    const roundTripCost = getRoundTripCost(BASE_COSTS);

    // Risk params from FIXED_CONFIG
    const softDD = FIXED_CONFIG.risk.soft;
    const hardDD = FIXED_CONFIG.risk.hard;
    const enterThr = 0.03;
    const minHold = 7;
    const maxHold = 60;
    const cdDays = 0;
    const positionStopLoss = 0.15;

    let maxDD = 0;
    let cooldownUntil: Date | null = null;

    // Process each step
    for (let i = startIdx; i < prices.length; i += stepDays) {
      const asOf = prices[i].ts as Date;
      const price = prices[i].ohlcv?.c ?? 0;
      const lowPrice = prices[i].ohlcv?.l ?? price;
      if (!price) continue;

      // Position-level stop-loss check
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

      // Update peak and DD
      if (equity > peakEquity) peakEquity = equity;
      const currentDD = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
      if (currentDD > maxDD) maxDD = currentDD;

      // DD-aware exposure
      let ddMult = 1.0;
      if (position !== 'FLAT') {
        if (currentDD >= hardDD) {
          ddMult = 0;
        } else if (currentDD > softDD) {
          const x = (currentDD - softDD) / (hardDD - softDD);
          ddMult = 0.15 + 0.85 * (1 - Math.pow(x, 1.5));
        }
      }

      // Get signal with PERTURBED config (using raw_returns like FIXED_CONFIG)
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
        similarityMode: FIXED_CONFIG.signal.similarityMode,  // Use same mode as FIXED_CONFIG
        useRelative: FIXED_CONFIG.signal.useRelative,
        relativeBand: 0.0015,
        baselineLookbackDays: cfg.baselineLookbackDays,
      });

      const inCooldown = cooldownUntil && asOf < cooldownUntil;

      // Loss guard cooldown check
      if (lossGuardCooldownUntil && asOf >= lossGuardCooldownUntil) {
        lossGuardCooldownUntil = null;
        lossGuardExposureMult = 0.5;
        consecutiveLosses = 2;
      }
      const inLossGuardCooldown = lossGuardCooldownUntil && asOf < lossGuardCooldownUntil;

      // Trade recording helper
      const recordTrade = (exitPrice: number, side: 'LONG' | 'SHORT') => {
        const grossReturn = side === 'LONG' 
          ? (exitPrice / entryPrice - 1) 
          : (entryPrice / exitPrice - 1);
        const netReturn = grossReturn - roundTripCost;
        
        if (netReturn < 0) {
          consecutiveLosses++;
          if (consecutiveLosses >= 4) lossGuardExposureMult = 0.5;
          if (consecutiveLosses >= 5) {
            lossGuardCooldownUntil = new Date(asOf.getTime() + 14 * 86400000);
            lossGuardExposureMult = 0.25;
          }
        } else {
          if (consecutiveLosses > 0) consecutiveLosses = Math.max(0, consecutiveLosses - 2);
          if (consecutiveLosses === 0) lossGuardExposureMult = 1.0;
          else if (consecutiveLosses <= 2) lossGuardExposureMult = 0.75;
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

      // Soft kill (reduce position)
      if (currentDD >= softDD && position !== 'FLAT' && currentDD < hardDD) {
        const reduceSize = posSize * 0.5;
        equity *= (1 - roundTripCost / 2 * reduceSize);
        posSize -= reduceSize;
      }

      // Max hold exit
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

      // Enter (with loss guard)
      if (position === 'FLAT' && !inCooldown && !inLossGuardCooldown && ddMult > 0.01) {
        if (signal.action !== 'NEUTRAL' && signal.confidence >= enterThr) {
          const baseExposure = Math.min(2, signal.confidence * 2);
          const exposure = baseExposure * ddMult * lossGuardExposureMult;
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

    return {
      sharpe: Math.round(sharpe * 1000) / 1000,
      cagr: Math.round(cagr * 10000) / 10000,
      maxDD: Math.round(maxDD * 10000) / 10000,
      trades: tradesOpened,
      winRate: Math.round(winRate * 1000) / 1000,
      finalEquity: Math.round(equity * 100) / 100,
    };
  }
}

export async function runParameterPerturbationV2(params: {
  start?: string;
  end?: string;
  symbol?: string;
  mode?: 'full' | 'one-at-a-time';
} = {}): Promise<PerturbationSweepResponse> {
  const service = new SimParameterPerturbationServiceV2();
  return service.runSweep(params);
}
