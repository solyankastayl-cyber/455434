/**
 * BLOCK 36.5-36.7 — Multi-Horizon Simulation Service
 * 
 * Full walk-forward simulation using multi-horizon engine.
 * Compares V1 (single horizon) vs V2 (multi-horizon).
 */

import { CanonicalOhlcvModel } from '../data/schemas/fractal-canonical-ohlcv.schema.js';
import { 
  MultiHorizonEngine, 
  MultiHorizonConfig, 
  DEFAULT_MULTI_HORIZON_CONFIG,
  HorizonSignal 
} from '../engine/multi-horizon.engine.js';
import { RegimeKey } from '../engine/regime-conditioned.js';
import { FIXED_CONFIG } from './sim.oos.splits.js';
import { SimOverrides, BASE_COSTS, applyCostMultiplier, getRoundTripCost } from './sim.overrides.js';
import type { SimTrade } from './sim.montecarlo.js';

// BLOCK 36.10: Entropy Guard imports
import { 
  EntropyGuardConfig, 
  DEFAULT_ENTROPY_GUARD_CONFIG,
  HorizonSignal as EntropyHorizonSignal 
} from '../engine/v2/entropy.guard.js';
import { evalEntropyGuard, createEntropyEmaState, EntropyEmaState } from '../engine/v2/entropy.guard.eval.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface MultiHorizonSimResult {
  ok: boolean;
  period: { start: string; end: string };
  config: {
    horizons: number[];
    adaptiveFilterEnabled: boolean;
    entropyGuardEnabled: boolean;  // BLOCK 36.10
  };
  metrics: {
    sharpe: number;
    cagr: number;
    maxDD: number;
    maxDDStart: string;
    maxDDEnd: string;
    totalTrades: number;
    winRate: number;
    avgHoldDays: number;
    finalEquity: number;
  };
  regimeStats: {
    bull: number;
    bear: number;
    side: number;
    crash: number;
    bubble: number;
  };
  horizonUsage: Record<number, number>;  // how often each horizon was dominant
  consensusStats: {
    highConsensus: number;    // steps with consensus > 0.75
    lowConsensus: number;     // steps with consensus < 0.5
    avgConsensus: number;
  };
  // BLOCK 36.10: Entropy Guard stats
  entropyStats?: {
    avgEntropy: number;
    avgScale: number;
    warnCount: number;
    hardCount: number;
    dominanceCount: number;
  };
  yearlyBreakdown: YearMetrics[];
  equityCurve: EquityPoint[];
  trades: SimTrade[];
  verdict: string;
}

interface YearMetrics {
  year: number;
  sharpe: number;
  maxDD: number;
  trades: number;
  endEquity: number;
}

interface EquityPoint {
  date: string;
  equity: number;
  dd: number;
  regime: string;
  consensus: number;
}

// ═══════════════════════════════════════════════════════════════
// MULTI-HORIZON SIMULATION SERVICE
// ═══════════════════════════════════════════════════════════════

export class SimMultiHorizonService {
  private multiHorizon: MultiHorizonEngine;

  constructor() {
    this.multiHorizon = new MultiHorizonEngine();
  }

  /**
   * Run full walk-forward simulation with multi-horizon engine
   */
  async runFull(params: {
    start?: string;
    end?: string;
    symbol?: string;
    stepDays?: number;
    horizonConfig?: Partial<MultiHorizonConfig>;
    overrides?: SimOverrides & { entropyGuard?: Partial<EntropyGuardConfig> };
  } = {}): Promise<MultiHorizonSimResult> {
    const symbol = params.symbol ?? 'BTC';
    const stepDays = params.stepDays ?? 7;
    const startDate = params.start ?? '2014-01-01';
    const endDate = params.end ?? '2026-02-15';
    const overrides = params.overrides ?? {};
    
    const horizonConfig: MultiHorizonConfig = {
      ...DEFAULT_MULTI_HORIZON_CONFIG,
      ...params.horizonConfig,
    };

    // BLOCK 36.10: Entropy Guard config
    const entropyGuardConfig: EntropyGuardConfig = {
      ...DEFAULT_ENTROPY_GUARD_CONFIG,
      ...(overrides.entropyGuard ?? {}),
    };

    // Cost model
    const costMult = overrides.costMultiplier ?? 1.0;
    const costs = applyCostMultiplier(BASE_COSTS, costMult);
    const roundTripCost = getRoundTripCost(costs);
    
    console.log(`[MULTI-HORIZON SIM] Starting: ${startDate} -> ${endDate}`);
    console.log(`[MULTI-HORIZON SIM] Horizons: [${horizonConfig.horizons.join(', ')}]`);
    console.log(`[MULTI-HORIZON SIM] Adaptive filter: ${horizonConfig.adaptiveFilterEnabled}`);
    console.log(`[MULTI-HORIZON SIM] Entropy Guard: ${entropyGuardConfig.enabled}`);

    const from = new Date(startDate);
    const to = new Date(endDate);
    const cfg = FIXED_CONFIG.signal;

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
    let entryTs = '';
    let lastPrice = 0;
    let tradesOpened = 0;
    let tradesWon = 0;
    let tradePnl = 0;
    let realHoldDays = 0;
    let totalHoldDays = 0;

    // Regime and horizon tracking
    const regimeStats = { bull: 0, bear: 0, side: 0, crash: 0, bubble: 0 };
    const horizonUsage: Record<number, number> = {};
    for (const h of horizonConfig.horizons) horizonUsage[h] = 0;
    
    let totalConsensus = 0;
    let consensusCount = 0;
    let highConsensusCount = 0;
    let lowConsensusCount = 0;

    // BLOCK 36.10: Entropy Guard tracking
    const entropyEmaState = createEntropyEmaState();
    let totalEntropy = 0;
    let totalEntropyScale = 0;
    let entropyCount = 0;
    let entropyWarnCount = 0;
    let entropyHardCount = 0;
    let entropyDominanceCount = 0;

    const returns: number[] = [];
    const equityCurve: EquityPoint[] = [];
    const trades: SimTrade[] = [];
    const yearlyData: Map<number, { returns: number[]; trades: number; startEquity: number; endEquity: number }> = new Map();

    // MaxDD tracking
    let maxDD = 0;
    let maxDDStart = '';
    let maxDDEnd = '';
    let ddStartDate = '';

    // Risk params
    const softDD = FIXED_CONFIG.risk.soft;
    const hardDD = FIXED_CONFIG.risk.hard;
    const enterThr = 0.03;
    const minHold = 7;
    const maxHold = 60;

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
      if (position === 'LONG' && entryPrice > 0 && lowPrice > 0) {
        const priceDrop = (entryPrice - lowPrice) / entryPrice;
        if (priceDrop >= positionStopLoss) {
          const stopPrice = entryPrice * (1 - positionStopLoss);
          const stopRet = lastPrice > 0 ? stopPrice / lastPrice - 1 : 0;
          const stopPnl = stopRet * posSize;
          equity *= (1 + stopPnl);
          returns.push(stopPnl);
          yearlyData.get(year)!.returns.push(stopPnl);
          
          // Record trade
          const grossReturn = (stopPrice / entryPrice - 1);
          trades.push({
            entryTs,
            exitTs: asOf.toISOString(),
            side: 'LONG',
            entryPrice,
            exitPrice: stopPrice,
            netReturn: grossReturn - roundTripCost
          });
          
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
      yearlyData.get(year)!.returns.push(stepPnl);

      // Update peak and DD
      if (equity > peakEquity) {
        peakEquity = equity;
        ddStartDate = '';
      }
      const currentDD = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
      
      if (currentDD > 0 && !ddStartDate) {
        ddStartDate = asOf.toISOString().slice(0, 10);
      }
      
      if (currentDD > maxDD) {
        maxDD = currentDD;
        maxDDStart = ddStartDate || asOf.toISOString().slice(0, 10);
        maxDDEnd = asOf.toISOString().slice(0, 10);
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

      // Get multi-horizon signal
      let signal: {
        action: 'LONG' | 'SHORT' | 'NEUTRAL';
        confidence: number;
        regime: RegimeKey;
        weightedScore: number;
        consensusScore: number;
        horizonBreakdown: HorizonSignal[];
        entropyScale: number;  // BLOCK 36.10
      };

      try {
        const mhResult = await this.multiHorizon.runMultiHorizonMatch(asOf, horizonConfig);
        
        // BLOCK 36.10: Calculate entropy guard scale
        let entropyScale = 1.0;
        if (entropyGuardConfig.enabled && mhResult.signals.length > 0) {
          // Convert HorizonSignal to EntropyHorizonSignal format
          const entropySignals: EntropyHorizonSignal[] = mhResult.signals.map(s => ({
            horizonDays: s.horizon,
            side: s.direction,
            strength: Math.abs(s.mu),  // Use absolute return as strength
            confidence: s.confidence,
          }));
          
          const entropyResult = evalEntropyGuard(entropySignals, entropyGuardConfig, entropyEmaState);
          entropyScale = entropyResult.scale;
          
          // Track entropy stats
          totalEntropy += entropyResult.entropyNorm;
          totalEntropyScale += entropyResult.scale;
          entropyCount++;
          if (entropyResult.reason === 'WARN') entropyWarnCount++;
          if (entropyResult.reason === 'HARD') entropyHardCount++;
          if (entropyResult.reason === 'DOMINANCE') entropyDominanceCount++;
        }

        signal = {
          action: mhResult.assembled.direction,
          confidence: mhResult.assembled.confidence,
          regime: mhResult.regime,
          weightedScore: mhResult.assembled.weightedScore,
          consensusScore: mhResult.assembled.consensusScore,
          horizonBreakdown: mhResult.signals,
          entropyScale,
        };

        // Track regime
        const regimeKey = mhResult.regime.toLowerCase() as keyof typeof regimeStats;
        if (regimeStats[regimeKey] !== undefined) regimeStats[regimeKey]++;

        // Track consensus
        totalConsensus += signal.consensusScore;
        consensusCount++;
        if (signal.consensusScore >= 0.75) highConsensusCount++;
        if (signal.consensusScore < 0.5) lowConsensusCount++;

        // Track which horizon had strongest signal
        const strongestHorizon = mhResult.signals.reduce((max, s) => 
          Math.abs(s.mu) > Math.abs(max.mu) ? s : max
        );
        if (horizonUsage[strongestHorizon.horizon] !== undefined) {
          horizonUsage[strongestHorizon.horizon]++;
        }

      } catch (err) {
        signal = {
          action: 'NEUTRAL',
          confidence: 0,
          regime: 'SIDE',
          weightedScore: 0,
          consensusScore: 0,
          horizonBreakdown: [],
          entropyScale: 1.0,  // BLOCK 36.10
        };
      }

      const inCooldown = cooldownUntil && asOf < cooldownUntil;

      // Record trade helper
      const recordTrade = (exitPrice: number, side: 'LONG' | 'SHORT') => {
        const grossReturn = side === 'LONG' 
          ? (exitPrice / entryPrice - 1) 
          : (entryPrice / exitPrice - 1);
        trades.push({
          entryTs,
          exitTs: asOf.toISOString(),
          side,
          entryPrice,
          exitPrice,
          netReturn: grossReturn - roundTripCost
        });
      };

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
        cooldownUntil = new Date(asOf.getTime() + 14 * 86400000);
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
        cooldownUntil = new Date(asOf.getTime() + 7 * 86400000);
      }

      // Exit on signal flip or low consensus
      if (position !== 'FLAT' && realHoldDays >= minHold) {
        const oppositeSignal = (position === 'LONG' && signal.action === 'SHORT') ||
                               (position === 'SHORT' && signal.action === 'LONG');
        const weakSignal = signal.action === 'NEUTRAL' || signal.confidence < 0.05;
        const lowConsensus = signal.consensusScore < 0.4;

        if (oppositeSignal || (weakSignal && lowConsensus)) {
          recordTrade(price, position as 'LONG' | 'SHORT');
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

      // Enter new position (with consensus filter)
      if (position === 'FLAT' && !inCooldown && ddMult > 0.01) {
        // Require minimum consensus for entry
        const minConsensus = 0.5;
        if (signal.action !== 'NEUTRAL' && 
            signal.confidence >= enterThr && 
            signal.consensusScore >= minConsensus) {
          
          const baseExposure = Math.min(2, signal.confidence * 2);
          // Boost exposure when consensus is high
          const consensusBoost = signal.consensusScore > 0.75 ? 1.2 : 1.0;
          // BLOCK 36.10: Apply entropy scale multiplier
          const exposure = baseExposure * ddMult * consensusBoost * signal.entropyScale;
          
          if (exposure > 0.01) {
            equity *= (1 - roundTripCost / 2 * exposure);
            position = signal.action;
            posSize = exposure;
            entryPrice = price;
            entryTs = asOf.toISOString();
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
        equityCurve.push({
          date: asOf.toISOString().slice(0, 10),
          equity: Math.round(equity * 10000) / 10000,
          dd: Math.round(currentDD * 10000) / 10000,
          regime: signal.regime,
          consensus: Math.round(signal.consensusScore * 1000) / 1000,
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

    // Consensus stats
    const avgConsensus = consensusCount > 0 ? totalConsensus / consensusCount : 0;

    // BLOCK 36.10: Entropy stats
    const avgEntropy = entropyCount > 0 ? totalEntropy / entropyCount : 0;
    const avgEntropyScale = entropyCount > 0 ? totalEntropyScale / entropyCount : 1;

    // Verdict
    let verdict = '';
    if (sharpe >= 0.75 && maxDD <= 0.30 && tradesOpened >= 40) {
      verdict = '✅ V2 MULTI-HORIZON CERTIFIED — Production ready';
    } else if (sharpe >= 0.55 && maxDD <= 0.35) {
      verdict = '🟡 V2 MULTI-HORIZON ACCEPTABLE — Minor tuning needed';
    } else {
      verdict = '🔴 V2 MULTI-HORIZON NEEDS WORK — Structural issues';
    }

    console.log(`[MULTI-HORIZON SIM] Complete: Sharpe=${sharpe.toFixed(3)}, MaxDD=${(maxDD*100).toFixed(1)}%, Trades=${tradesOpened}`);
    if (entropyGuardConfig.enabled) {
      console.log(`[MULTI-HORIZON SIM] Entropy Guard: avgEntropy=${avgEntropy.toFixed(3)}, avgScale=${avgEntropyScale.toFixed(3)}`);
    }

    return {
      ok: true,
      period: { start: startDate, end: endDate },
      config: {
        horizons: horizonConfig.horizons,
        adaptiveFilterEnabled: horizonConfig.adaptiveFilterEnabled,
        entropyGuardEnabled: entropyGuardConfig.enabled,
      },
      metrics: {
        sharpe: Math.round(sharpe * 1000) / 1000,
        cagr: Math.round(cagr * 10000) / 10000,
        maxDD: Math.round(maxDD * 10000) / 10000,
        maxDDStart,
        maxDDEnd,
        totalTrades: tradesOpened,
        winRate: Math.round(winRate * 1000) / 1000,
        avgHoldDays: Math.round(avgHoldDays),
        finalEquity: Math.round(equity * 10000) / 10000,
      },
      regimeStats,
      horizonUsage,
      consensusStats: {
        highConsensus: highConsensusCount,
        lowConsensus: lowConsensusCount,
        avgConsensus: Math.round(avgConsensus * 1000) / 1000,
      },
      // BLOCK 36.10: Entropy Guard stats
      entropyStats: entropyGuardConfig.enabled ? {
        avgEntropy: Math.round(avgEntropy * 1000) / 1000,
        avgScale: Math.round(avgEntropyScale * 1000) / 1000,
        warnCount: entropyWarnCount,
        hardCount: entropyHardCount,
        dominanceCount: entropyDominanceCount,
      } : undefined,
      yearlyBreakdown,
      equityCurve,
      trades,
      verdict,
    };
  }
}

// Export singleton
export const simMultiHorizonService = new SimMultiHorizonService();
