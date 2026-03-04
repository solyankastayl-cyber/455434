/**
 * BLOCK 34.7 — Signal Surface Sweep
 * 
 * Varies signal generation parameters to find the sweet spot:
 * - momentum threshold
 * - similarity threshold  
 * - minMatches
 * 
 * Key principle: Risk and Gate are FROZEN.
 * We only explore Signal Layer parameters.
 */

import { CanonicalOhlcvModel } from '../data/schemas/fractal-canonical-ohlcv.schema.js';
import { FractalSimulationRunner, SimConfig } from './sim.runner.js';
import { FIXED_CONFIG } from './sim.oos.splits.js';

export interface SignalConfig {
  momentumThreshold: number;    // Default was 0.03
  similarityThreshold: number;  // Not used in current simple signal, for future
  minMatches: number;           // Not used in current simple signal, for future
}

export interface SignalSweepResult {
  momentum: number;
  similarity: number;
  minMatches: number;
  trades: number;
  sharpe: number;
  maxDD: number;
  cagr: number;
  finalEquity: number;
  winRate: number;
  avgHoldDays: number;
  pass: boolean;
  reasons: string[];
}

export interface SignalSweepSummary {
  ok: boolean;
  totalConfigs: number;
  passedConfigs: number;
  results: SignalSweepResult[];
  bestConfig: SignalSweepResult | null;
  top5: SignalSweepResult[];
  surfaceAnalysis: {
    tradesVsMomentum: { momentum: number; avgTrades: number }[];
    sharpeVsMomentum: { momentum: number; avgSharpe: number }[];
    sweetSpotRegion: string;
  };
}

// Default sweep parameters
export const DEFAULT_SWEEP_PARAMS = {
  momentum: [0.01, 0.015, 0.02, 0.025, 0.03],
  similarity: [0.60, 0.65, 0.70, 0.75],
  minMatches: [5, 10, 15]
};

// Pass thresholds (same as OOS)
export const SIGNAL_THRESHOLDS = {
  minTrades: 20,      // More trades required for signal sweep
  minSharpe: 0.45,
  maxDD: 0.35,
  minWinRate: 0.52
};

export class SignalSweepService {
  /**
   * Run Signal Surface Sweep
   * Tests combinations of signal parameters while keeping risk/gate frozen
   */
  async sweep(params: {
    testWindow: { from: string; to: string };
    momentum?: number[];
    similarity?: number[];
    minMatches?: number[];
    stepDays?: number;
  }): Promise<SignalSweepSummary> {
    const momentum = params.momentum ?? DEFAULT_SWEEP_PARAMS.momentum;
    const similarity = params.similarity ?? DEFAULT_SWEEP_PARAMS.similarity;
    const minMatches = params.minMatches ?? DEFAULT_SWEEP_PARAMS.minMatches;
    const stepDays = params.stepDays ?? 7;
    
    const totalConfigs = momentum.length * similarity.length * minMatches.length;
    console.log(`[SignalSweep] Starting sweep: ${totalConfigs} configurations`);
    console.log(`[SignalSweep] Test window: ${params.testWindow.from} → ${params.testWindow.to}`);
    
    const results: SignalSweepResult[] = [];
    let processed = 0;
    
    for (const m of momentum) {
      for (const s of similarity) {
        for (const k of minMatches) {
          processed++;
          console.log(`[SignalSweep] ${processed}/${totalConfigs}: momentum=${m}, similarity=${s}, minMatches=${k}`);
          
          try {
            const simResult = await this.runSimWithSignalConfig({
              testWindow: params.testWindow,
              signalConfig: {
                momentumThreshold: m,
                similarityThreshold: s,
                minMatches: k
              },
              stepDays
            });
            
            // Calculate win rate from regime breakdown
            const trades = simResult.tradesOpened;
            const regimeBreakdown = simResult.regimeBreakdown || {};
            let totalPnl = 0;
            let wins = 0;
            for (const regime of Object.values(regimeBreakdown) as any[]) {
              totalPnl += regime.pnl || 0;
              if (regime.pnl > 0) wins += regime.trades;
            }
            const winRate = trades > 0 ? wins / trades : 0;
            
            // Evaluate pass/fail
            const reasons: string[] = [];
            let pass = true;
            
            if (trades < SIGNAL_THRESHOLDS.minTrades) {
              pass = false;
              reasons.push(`Trades ${trades} < ${SIGNAL_THRESHOLDS.minTrades}`);
            }
            if (simResult.sharpe < SIGNAL_THRESHOLDS.minSharpe) {
              pass = false;
              reasons.push(`Sharpe ${simResult.sharpe.toFixed(3)} < ${SIGNAL_THRESHOLDS.minSharpe}`);
            }
            if (simResult.maxDD > SIGNAL_THRESHOLDS.maxDD) {
              pass = false;
              reasons.push(`MaxDD ${(simResult.maxDD * 100).toFixed(1)}% > ${SIGNAL_THRESHOLDS.maxDD * 100}%`);
            }
            
            if (pass) {
              reasons.push('All thresholds met');
            }
            
            results.push({
              momentum: m,
              similarity: s,
              minMatches: k,
              trades,
              sharpe: Math.round(simResult.sharpe * 1000) / 1000,
              maxDD: Math.round(simResult.maxDD * 10000) / 10000,
              cagr: Math.round(simResult.cagr * 10000) / 10000,
              finalEquity: Math.round(simResult.finalEquity * 10000) / 10000,
              winRate: Math.round(winRate * 1000) / 1000,
              avgHoldDays: Math.round((simResult.totalDays / Math.max(1, trades)) * 10) / 10,
              pass,
              reasons
            });
            
          } catch (err) {
            console.error(`[SignalSweep] Error at m=${m}, s=${s}, k=${k}:`, err);
            results.push({
              momentum: m,
              similarity: s,
              minMatches: k,
              trades: 0,
              sharpe: 0,
              maxDD: 1,
              cagr: 0,
              finalEquity: 0,
              winRate: 0,
              avgHoldDays: 0,
              pass: false,
              reasons: [err instanceof Error ? err.message : String(err)]
            });
          }
        }
      }
    }
    
    // Rank results by composite score (sharpe - dd penalty + trade bonus)
    const rankedResults = [...results].sort((a, b) => {
      const scoreA = a.sharpe - (a.maxDD * 0.5) + (Math.min(a.trades, 30) / 100);
      const scoreB = b.sharpe - (b.maxDD * 0.5) + (Math.min(b.trades, 30) / 100);
      return scoreB - scoreA;
    });
    
    const passedConfigs = results.filter(r => r.pass).length;
    const bestConfig = rankedResults[0] || null;
    const top5 = rankedResults.slice(0, 5);
    
    // Surface analysis
    const surfaceAnalysis = this.analyzeSurface(results, momentum);
    
    console.log(`[SignalSweep] Complete: ${passedConfigs}/${totalConfigs} passed`);
    if (bestConfig) {
      console.log(`[SignalSweep] Best: momentum=${bestConfig.momentum}, sharpe=${bestConfig.sharpe}, trades=${bestConfig.trades}`);
    }
    
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
   * Run simulation with custom signal config
   */
  private async runSimWithSignalConfig(params: {
    testWindow: { from: string; to: string };
    signalConfig: SignalConfig;
    stepDays: number;
  }): Promise<{
    sharpe: number;
    maxDD: number;
    cagr: number;
    finalEquity: number;
    tradesOpened: number;
    totalDays: number;
    regimeBreakdown: any;
  }> {
    // We'll run a custom simulation loop with our signal config
    const { testWindow, signalConfig, stepDays } = params;
    
    const from = new Date(testWindow.from);
    const to = new Date(testWindow.to);
    
    // Get all prices in range
    const prices = await CanonicalOhlcvModel.find({
      'meta.symbol': 'BTC',
      ts: { $gte: from, $lte: to }
    }).sort({ ts: 1 }).lean() as any[];
    
    if (prices.length < 60) {
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
    let holdDays = 0;
    let tradePnl = 0;
    const returns: number[] = [];
    const regimeBreakdown: Record<string, { trades: number; pnl: number }> = {};
    let currentRegimeKey = '';
    
    // Fixed risk config (from OOS)
    const softDD = FIXED_CONFIG.risk.soft;
    const hardDD = FIXED_CONFIG.risk.hard;
    // Entry threshold scales with momentum config
    // momentum=0.01 → enterThr=0.03, momentum=0.03 → enterThr=0.09
    const enterThr = signalConfig.momentumThreshold * 3;
    const minHold = Math.max(5, signalConfig.minMatches);  // minMatches affects min hold
    const maxHold = 45;
    // Cooldown scales inversely with similarity (higher similarity = faster re-entry)  
    const cdDays = Math.max(3, Math.round(5 * (1 - signalConfig.similarityThreshold + 0.4)));
    const roundTripCost = 2 * (4 + 6 + 2) / 10000; // 24 bps round trip
    
    let cooldownUntil: Date | null = null;
    let stepIdx = 0;
    const actualStep = Math.max(1, stepDays);  // Ensure integer step
    
    // Process in steps
    for (let i = 90; i < prices.length; i += actualStep) {
      stepIdx++;
      const asOf = prices[i].ts as Date;
      const price = prices[i].ohlcv?.c ?? 0;
      if (!price) continue;
      
      // Calculate step PnL
      let stepPnl = 0;
      if (position !== 'FLAT' && lastPrice > 0) {
        const ret = price / lastPrice - 1;
        stepPnl = position === 'LONG' ? ret * posSize : -ret * posSize;
        equity *= (1 + stepPnl);
        holdDays += actualStep;  // Use integer step
        tradePnl += stepPnl;
      }
      returns.push(stepPnl);
      
      if (equity > peakEquity) peakEquity = equity;
      const currentDD = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
      
      // Get signal with custom config
      const signal = this.getSignal(prices, i, signalConfig);
      // Apply similarity as confidence multiplier (higher similarity = more confidence)
      const adjustedConfidence = signal.confidence * (0.7 + signalConfig.similarityThreshold * 0.5);
      currentRegimeKey = `${signal.regime.trend}_${signal.regime.volatility}`;
      
      const inCooldown = cooldownUntil && asOf < cooldownUntil;
      
      // Position management (same as runner)
      
      // Hard kill
      if (currentDD >= hardDD && position !== 'FLAT') {
        equity *= (1 - roundTripCost / 2 * posSize);
        if (!regimeBreakdown[currentRegimeKey]) regimeBreakdown[currentRegimeKey] = { trades: 0, pnl: 0 };
        regimeBreakdown[currentRegimeKey].pnl += tradePnl;
        position = 'FLAT';
        posSize = 0;
        holdDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 2 * 86400000);
      }
      // Soft kill
      else if (currentDD >= softDD && position !== 'FLAT') {
        const reduceSize = posSize * 0.5;
        equity *= (1 - roundTripCost / 2 * reduceSize);
        posSize -= reduceSize;
      }
      // Max hold force exit
      else if (position !== 'FLAT' && holdDays >= maxHold) {
        equity *= (1 - roundTripCost / 2 * posSize);
        if (!regimeBreakdown[currentRegimeKey]) regimeBreakdown[currentRegimeKey] = { trades: 0, pnl: 0 };
        regimeBreakdown[currentRegimeKey].pnl += tradePnl;
        position = 'FLAT';
        posSize = 0;
        holdDays = 0;
        tradePnl = 0;
        cooldownUntil = new Date(asOf.getTime() + cdDays * 86400000);
      }
      // Exit on signal flip (opposite direction)
      else if (position !== 'FLAT' && holdDays >= minHold) {
        const oppositeSignal = (position === 'LONG' && signal.direction === 'SHORT') ||
                               (position === 'SHORT' && signal.direction === 'LONG');
        const weakSignal = signal.direction === 'NEUTRAL' || adjustedConfidence < 0.08;
        
        if (oppositeSignal || weakSignal) {
          equity *= (1 - roundTripCost / 2 * posSize);
          if (!regimeBreakdown[currentRegimeKey]) regimeBreakdown[currentRegimeKey] = { trades: 0, pnl: 0 };
          regimeBreakdown[currentRegimeKey].pnl += tradePnl;
          position = 'FLAT';
          posSize = 0;
          holdDays = 0;
          tradePnl = 0;
          cooldownUntil = new Date(asOf.getTime() + cdDays * 86400000);
        }
      }
      // Enter
      else if (position === 'FLAT' && !inCooldown) {
        if (signal.direction !== 'NEUTRAL' && adjustedConfidence >= enterThr) {
          const exposure = Math.min(2, adjustedConfidence * 2);
          if (exposure > 0.01) {
            equity *= (1 - roundTripCost / 2 * exposure);
            position = signal.direction as 'LONG' | 'SHORT';
            posSize = exposure;
            entryPrice = price;
            holdDays = 0;
            tradePnl = 0;
            tradesOpened++;
            if (!regimeBreakdown[currentRegimeKey]) regimeBreakdown[currentRegimeKey] = { trades: 0, pnl: 0 };
            regimeBreakdown[currentRegimeKey].trades++;
          }
        }
      }
      
      lastPrice = price;
    }
    
    // Calculate metrics
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
    
    return {
      sharpe,
      maxDD,
      cagr,
      finalEquity: equity,
      tradesOpened,
      totalDays: returns.length * stepDays,
      regimeBreakdown
    };
  }
  
  /**
   * Generate signal with custom momentum threshold
   */
  private getSignal(prices: any[], currentIdx: number, config: SignalConfig): {
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    confidence: number;
    regime: { trend: string; volatility: string };
  } {
    const closes: number[] = [];
    for (let i = Math.max(0, currentIdx - 89); i <= currentIdx; i++) {
      closes.push(prices[i]?.ohlcv?.c ?? 0);
    }
    
    if (closes.length < 60) {
      return { direction: 'NEUTRAL', confidence: 0, regime: { trend: 'UNK', volatility: 'UNK' } };
    }
    
    // Momentum calculation
    const recent = closes.slice(-30);
    const older = closes.slice(-60, -30);
    
    const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderMean = older.reduce((a, b) => a + b, 0) / older.length;
    const momentum = olderMean > 0 ? (recentMean / olderMean - 1) : 0;
    
    // Volatility
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > 0 && closes[i-1] > 0) {
        returns.push(Math.log(closes[i] / closes[i - 1]));
      }
    }
    const vol = Math.sqrt(returns.reduce((a, b) => a + b * b, 0) / Math.max(1, returns.length)) * Math.sqrt(365);
    
    // Regime
    const trend = momentum > 0.05 ? 'UP_TREND' : momentum < -0.05 ? 'DOWN_TREND' : 'SIDEWAYS';
    const volatility = vol > 0.8 ? 'HIGH_VOL' : vol < 0.4 ? 'LOW_VOL' : 'NORMAL_VOL';
    
    // Signal with CONFIGURABLE threshold
    let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = Math.abs(momentum) * 2;
    
    // THIS IS THE KEY CHANGE: use config.momentumThreshold instead of hardcoded 0.03
    if (momentum > config.momentumThreshold) direction = 'LONG';
    else if (momentum < -config.momentumThreshold) direction = 'SHORT';
    
    // Reduce confidence in crash regime
    if (trend === 'DOWN_TREND' && volatility === 'HIGH_VOL') {
      confidence *= 0.3;
    }
    
    return {
      direction,
      confidence: Math.min(1, confidence),
      regime: { trend, volatility }
    };
  }
  
  /**
   * Analyze surface patterns
   */
  private analyzeSurface(results: SignalSweepResult[], momentumValues: number[]): {
    tradesVsMomentum: { momentum: number; avgTrades: number }[];
    sharpeVsMomentum: { momentum: number; avgSharpe: number }[];
    sweetSpotRegion: string;
  } {
    // Group by momentum
    const tradesVsMomentum: { momentum: number; avgTrades: number }[] = [];
    const sharpeVsMomentum: { momentum: number; avgSharpe: number }[] = [];
    
    for (const m of momentumValues) {
      const mResults = results.filter(r => r.momentum === m);
      if (mResults.length > 0) {
        const avgTrades = mResults.reduce((a, b) => a + b.trades, 0) / mResults.length;
        const avgSharpe = mResults.reduce((a, b) => a + b.sharpe, 0) / mResults.length;
        tradesVsMomentum.push({ momentum: m, avgTrades: Math.round(avgTrades * 10) / 10 });
        sharpeVsMomentum.push({ momentum: m, avgSharpe: Math.round(avgSharpe * 1000) / 1000 });
      }
    }
    
    // Find sweet spot (highest sharpe with trades >= 20)
    const validResults = results.filter(r => r.trades >= 20 && r.sharpe > 0);
    let sweetSpotRegion = 'No valid region found';
    
    if (validResults.length > 0) {
      const best = validResults.sort((a, b) => b.sharpe - a.sharpe)[0];
      sweetSpotRegion = `momentum=${best.momentum}, similarity=${best.similarity}, minMatches=${best.minMatches} (Sharpe=${best.sharpe}, Trades=${best.trades})`;
    } else {
      // Find closest to valid
      const almostValid = results.filter(r => r.trades >= 10).sort((a, b) => b.sharpe - a.sharpe);
      if (almostValid.length > 0) {
        const best = almostValid[0];
        sweetSpotRegion = `Closest: momentum=${best.momentum} (Sharpe=${best.sharpe}, Trades=${best.trades}) - needs more trades`;
      }
    }
    
    return {
      tradesVsMomentum,
      sharpeVsMomentum,
      sweetSpotRegion
    };
  }
}
