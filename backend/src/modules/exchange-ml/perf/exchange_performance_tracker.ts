/**
 * Exchange Performance Tracker
 * ============================
 * 
 * Capital-centric metrics engine for the dual-model Exchange system.
 * 
 * Key metrics:
 * - TradeWinRate: wins / (wins + losses), excluding NEUTRAL
 * - MaxDrawdown: peak-to-trough equity decline
 * - StabilityScore: volatility-adjusted consistency
 * - SharpeLike: mean return / std return
 * 
 * This replaces accuracy-based lifecycle decisions with real trading performance.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type OutcomeResult = 'WIN' | 'LOSS' | 'NEUTRAL';
export type TradeHorizon = '1D' | '7D' | '30D';

export interface TradeOutcome {
  t: number;                      // unix seconds (resolvedAt)
  horizon: TradeHorizon;
  symbol: string;
  
  // return in decimal, e.g., +0.012 = +1.2%
  // IMPORTANT: direction-aware (LONG profit = positive, SHORT profit = positive)
  returnPct: number;
  
  result: OutcomeResult;          // WIN/LOSS/NEUTRAL
  modelId: string;                // active or shadow model id
  isShadow?: boolean;
}

export interface PerfWindow {
  horizon: TradeHorizon;
  symbol: string;
  windowDays: number;
  
  // Sample counts
  sampleCount: number;            // all trades including neutrals
  wins: number;
  losses: number;
  neutrals: number;
  
  // Core metrics
  tradeWinRate: number;           // wins / (wins + losses)
  avgReturn: number;              // mean(returnPct)
  stdReturn: number;              // std(returnPct)
  sharpeLike: number;             // mean / std
  
  // Equity metrics
  equityFinal: number;            // equity after window (starting from 1.0)
  maxDrawdown: number;            // 0..1, max peak-to-trough
  consecutiveLossMax: number;     // longest losing streak
  
  // Stability
  stabilityScore: number;         // 0..1, higher = more stable
  
  // Time bounds
  startT: number;
  endT: number;
}

export interface ModelComparison {
  activeWindow: PerfWindow;
  shadowWindow: PerfWindow;
  
  // Deltas (shadow - active)
  winRateDelta: number;
  sharpeDelta: number;
  stabilityDelta: number;
  drawdownDelta: number;          // negative = shadow has less drawdown (better)
  
  // Verdict
  shadowBetter: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function computeEquityAndDD(returns: number[]): { equityFinal: number; maxDrawdown: number } {
  let equity = 1.0;
  let peak = 1.0;
  let maxDD = 0.0;
  
  for (const r of returns) {
    equity = equity * (1 + r);
    peak = Math.max(peak, equity);
    const dd = (peak - equity) / peak;
    maxDD = Math.max(maxDD, dd);
  }
  
  return { 
    equityFinal: equity, 
    maxDrawdown: clamp(0, 1, maxDD) 
  };
}

function computeConsecutiveLossMax(returns: number[]): number {
  let current = 0;
  let max = 0;
  
  for (const r of returns) {
    if (r < 0) {
      current++;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  
  return max;
}

/**
 * StabilityScore calculation:
 * 1. volatilityRatio = std / |mean|
 * 2. baseStability = 1 / (1 + volatilityRatio)
 * 3. penalty by drawdown: * (1 - maxDD)
 * 
 * Result: 0..1, higher = more stable
 */
function computeStability(meanR: number, stdR: number, maxDD: number): number {
  if (stdR <= 0) {
    return clamp(0, 1, 1 - maxDD);
  }
  
  const denom = Math.max(1e-9, Math.abs(meanR));
  const volRatio = stdR / denom;
  const base = 1 / (1 + volRatio);
  
  return clamp(0, 1, base * (1 - maxDD));
}

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE TRACKER CLASS
// ═══════════════════════════════════════════════════════════════

export class ExchangePerformanceTracker {
  
  /**
   * Compute performance window for a set of trades.
   * 
   * @param params.horizon - Trading horizon
   * @param params.symbol - Asset symbol
   * @param params.windowDays - Window size in days
   * @param params.nowT - End time (unix seconds)
   * @param params.trades - All trade outcomes
   * @param params.includeNeutralsInSamples - Include neutrals in sampleCount (default: true)
   */
  computeWindow(params: {
    horizon: TradeHorizon;
    symbol: string;
    windowDays: number;
    nowT: number;
    trades: TradeOutcome[];
    includeNeutralsInSamples?: boolean;
  }): PerfWindow {
    const { horizon, symbol, windowDays, nowT, trades } = params;
    const includeNeutralsInSamples = params.includeNeutralsInSamples ?? true;
    
    const startT = nowT - windowDays * 86400;
    
    // Filter trades in window
    const inWindow = trades
      .filter(t => 
        t.symbol === symbol && 
        t.horizon === horizon && 
        t.t >= startT && 
        t.t <= nowT
      )
      .sort((a, b) => a.t - b.t);
    
    // Count outcomes
    const wins = inWindow.filter(t => t.result === 'WIN').length;
    const losses = inWindow.filter(t => t.result === 'LOSS').length;
    const neutrals = inWindow.filter(t => t.result === 'NEUTRAL').length;
    
    // TradeWinRate excludes neutrals
    const denomWL = wins + losses;
    const tradeWinRate = denomWL > 0 ? wins / denomWL : 0;
    
    // Returns for all trades (including neutrals with 0 return)
    const returns = inWindow.map(t => t.returnPct);
    const avgReturn = mean(returns);
    const stdReturn = std(returns);
    const sharpeLike = stdReturn > 0 ? avgReturn / stdReturn : 0;
    
    // Equity and drawdown
    const { equityFinal, maxDrawdown } = computeEquityAndDD(returns);
    const consecutiveLossMax = computeConsecutiveLossMax(returns);
    
    // Stability score
    const stabilityScore = computeStability(avgReturn, stdReturn, maxDrawdown);
    
    // Sample count
    const sampleCount = includeNeutralsInSamples ? inWindow.length : (wins + losses);
    
    return {
      horizon,
      symbol,
      windowDays,
      
      sampleCount,
      wins,
      losses,
      neutrals,
      
      tradeWinRate,
      avgReturn,
      stdReturn,
      sharpeLike,
      equityFinal,
      maxDrawdown,
      consecutiveLossMax,
      stabilityScore,
      
      startT,
      endT: nowT,
    };
  }
  
  /**
   * Compute rolling windows (e.g., 7d, 14d, 30d, 60d).
   */
  computeRollingWindows(params: {
    horizon: TradeHorizon;
    symbol: string;
    nowT: number;
    trades: TradeOutcome[];
    windows?: number[];
  }): Record<number, PerfWindow> {
    const { horizon, symbol, nowT, trades } = params;
    const windows = params.windows || [7, 14, 30, 60];
    
    const results: Record<number, PerfWindow> = {};
    
    for (const windowDays of windows) {
      results[windowDays] = this.computeWindow({
        horizon,
        symbol,
        windowDays,
        nowT,
        trades,
      });
    }
    
    return results;
  }
  
  /**
   * Compare active vs shadow model performance.
   */
  compareModels(params: {
    horizon: TradeHorizon;
    symbol: string;
    windowDays: number;
    nowT: number;
    activeTrades: TradeOutcome[];
    shadowTrades: TradeOutcome[];
    minSamples?: number;
  }): ModelComparison {
    const { horizon, symbol, windowDays, nowT, minSamples = 30 } = params;
    
    const activeWindow = this.computeWindow({
      horizon,
      symbol,
      windowDays,
      nowT,
      trades: params.activeTrades,
    });
    
    const shadowWindow = this.computeWindow({
      horizon,
      symbol,
      windowDays,
      nowT,
      trades: params.shadowTrades,
    });
    
    // Calculate deltas
    const winRateDelta = shadowWindow.tradeWinRate - activeWindow.tradeWinRate;
    const sharpeDelta = shadowWindow.sharpeLike - activeWindow.sharpeLike;
    const stabilityDelta = shadowWindow.stabilityScore - activeWindow.stabilityScore;
    const drawdownDelta = shadowWindow.maxDrawdown - activeWindow.maxDrawdown;
    
    // Determine if shadow is better
    let shadowBetter = false;
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    let reason = '';
    
    // Need sufficient samples
    if (shadowWindow.sampleCount < minSamples) {
      reason = `Insufficient samples: ${shadowWindow.sampleCount} < ${minSamples}`;
    } 
    // Shadow must have better win rate OR better risk-adjusted returns
    else if (winRateDelta >= 0.02 && drawdownDelta <= 0) {
      shadowBetter = true;
      confidence = winRateDelta >= 0.05 ? 'HIGH' : 'MEDIUM';
      reason = `Shadow wins: +${(winRateDelta * 100).toFixed(1)}% WinRate, ${drawdownDelta <= 0 ? 'same/better' : 'worse'} drawdown`;
    }
    else if (sharpeDelta >= 0.1 && stabilityDelta >= 0) {
      shadowBetter = true;
      confidence = sharpeDelta >= 0.2 ? 'HIGH' : 'MEDIUM';
      reason = `Shadow wins: +${sharpeDelta.toFixed(2)} Sharpe, ${stabilityDelta >= 0 ? 'stable' : 'less stable'}`;
    }
    else {
      reason = 'Active model still better or no significant improvement';
    }
    
    return {
      activeWindow,
      shadowWindow,
      winRateDelta,
      sharpeDelta,
      stabilityDelta,
      drawdownDelta,
      shadowBetter,
      confidence,
      reason,
    };
  }
  
  /**
   * Check if model needs rollback based on capital metrics.
   * 
   * Rollback criteria (must meet multiple):
   * - TradeWinRate < floor AND
   * - (MaxDrawdown > ceiling OR consecutiveLosses >= threshold)
   */
  checkRollbackNeeded(params: {
    window: PerfWindow;
    rules: {
      minSamples: number;
      winRateFloor: number;
      maxDrawdownCeil: number;
      minStability: number;
      maxConsecutiveLosses: number;
    };
  }): { needed: boolean; reason: string; severity: 'NONE' | 'WARNING' | 'CRITICAL' } {
    const { window, rules } = params;
    
    // Guard: not enough data
    if (window.sampleCount < rules.minSamples) {
      return { needed: false, reason: 'INSUFFICIENT_SAMPLES', severity: 'NONE' };
    }
    
    const ddBad = window.maxDrawdown > rules.maxDrawdownCeil;
    const stabilityBad = window.stabilityScore < rules.minStability;
    const winBad = window.tradeWinRate < rules.winRateFloor;
    const streakBad = window.consecutiveLossMax >= rules.maxConsecutiveLosses;
    
    // Rollback condition 1: streak killer
    if (streakBad && (ddBad || winBad)) {
      return {
        needed: true,
        reason: `STREAK_KILLER: ${window.consecutiveLossMax} consecutive losses, DD=${(window.maxDrawdown * 100).toFixed(1)}%`,
        severity: 'CRITICAL',
      };
    }
    
    // Rollback condition 2: capital instability
    if (ddBad && stabilityBad && winBad) {
      return {
        needed: true,
        reason: `CAPITAL_INSTABILITY: WinRate=${(window.tradeWinRate * 100).toFixed(1)}%, DD=${(window.maxDrawdown * 100).toFixed(1)}%, Stability=${window.stabilityScore.toFixed(2)}`,
        severity: 'CRITICAL',
      };
    }
    
    // Warning: approaching danger zone
    if (winBad || ddBad) {
      return {
        needed: false,
        reason: `WARNING: metrics degrading but not critical`,
        severity: 'WARNING',
      };
    }
    
    return { needed: false, reason: 'HEALTHY', severity: 'NONE' };
  }
  
  /**
   * Check if shadow should be promoted based on capital metrics.
   */
  checkPromotionReady(params: {
    comparison: ModelComparison;
    rules: {
      minSamples: number;
      minWinRateLift: number;
      minSharpeLift: number;
      maxDDForPromo: number;
      minStability: number;
    };
  }): { ready: boolean; reason: string } {
    const { comparison, rules } = params;
    const { shadowWindow } = comparison;
    
    // Sample guard
    if (shadowWindow.sampleCount < rules.minSamples) {
      return { ready: false, reason: `SAMPLES_LOW: ${shadowWindow.sampleCount} < ${rules.minSamples}` };
    }
    
    // Hard safety: shadow must not have excessive drawdown
    if (shadowWindow.maxDrawdown > rules.maxDDForPromo) {
      return { ready: false, reason: `DD_TOO_HIGH: ${(shadowWindow.maxDrawdown * 100).toFixed(1)}% > ${rules.maxDDForPromo * 100}%` };
    }
    
    // Hard safety: shadow must be stable
    if (shadowWindow.stabilityScore < rules.minStability) {
      return { ready: false, reason: `STABILITY_TOO_LOW: ${shadowWindow.stabilityScore.toFixed(2)} < ${rules.minStability}` };
    }
    
    // Must show improvement
    const winLift = comparison.winRateDelta;
    const sharpeLift = comparison.sharpeDelta;
    
    if (winLift < rules.minWinRateLift && sharpeLift < rules.minSharpeLift) {
      return { ready: false, reason: `NO_IMPROVEMENT: WinRate +${(winLift * 100).toFixed(1)}%, Sharpe +${sharpeLift.toFixed(2)}` };
    }
    
    return { 
      ready: true, 
      reason: `IMPROVED: WinRate +${(winLift * 100).toFixed(1)}%, Sharpe +${sharpeLift.toFixed(2)}` 
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let trackerInstance: ExchangePerformanceTracker | null = null;

export function getExchangePerformanceTracker(): ExchangePerformanceTracker {
  if (!trackerInstance) {
    trackerInstance = new ExchangePerformanceTracker();
  }
  return trackerInstance;
}

console.log('[Exchange ML] Performance tracker loaded');
