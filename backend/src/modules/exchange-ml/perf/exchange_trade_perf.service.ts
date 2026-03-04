/**
 * Exchange Trade Performance Service
 * ===================================
 * 
 * Computes capital-centric metrics for trade performance analysis.
 * 
 * Key metrics:
 * - WinRate: wins / (wins + losses)
 * - Expectancy: avg pnlPct per trade (the "edge")
 * - SharpeLike: mean/std * sqrt(n) — risk-adjusted returns
 * - MaxDD: max drawdown — peak-to-trough equity decline
 * 
 * This service enables the Performance Dashboard and helps identify
 * which market regimes the model performs best/worst in.
 */

import { TradeRecord, Horizon, RegimeTag, PerfWindow } from './exchange_trade_types.js';

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeTradePerfService {
  
  /**
   * Compute performance window for a set of trade records.
   * 
   * @param records - All trade records
   * @param horizon - Filter by horizon
   * @param days - Window size in days
   * @returns Performance metrics for the window
   */
  compute(records: TradeRecord[], horizon: Horizon, days: number): PerfWindow {
    // Filter by horizon
    const xs = records.filter(r => r.horizon === horizon);
    const n = xs.length;

    // Empty result for no trades
    if (!n) {
      return this.emptyWindow(horizon, days);
    }

    // Count wins/losses
    const wins = xs.filter(x => x.win).length;
    const losses = n - wins;
    
    // PnL array for statistical calculations
    const pnls = xs.map(x => x.pnlPct);
    
    // Mean and variance
    const mean = pnls.reduce((a, b) => a + b, 0) / n;
    const variance = pnls.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1);
    const std = Math.sqrt(variance);

    // Equity curve drawdown calculation
    let eq = 1;
    let peak = 1;
    let maxDD = 0;
    for (const p of pnls) {
      eq *= (1 + p);
      peak = Math.max(peak, eq);
      maxDD = Math.max(maxDD, (peak - eq) / peak);
    }

    // Average R multiple
    const avgR = xs.reduce((a, b) => a + b.rMultiple, 0) / n;
    
    // Sharpe-like ratio (annualized-ish by sqrt(n))
    const sharpeLike = std > 0 ? (mean / std) * Math.sqrt(n) : 0;

    // Performance by regime
    const byRegime = this.computeByRegime(xs);

    return {
      horizon,
      days,
      trades: n,
      winRate: n > 0 ? wins / n : 0,
      expectancy: mean,
      avgR,
      sharpeLike,
      maxDD: clamp(0, 1, maxDD),
      holdRate: 0, // Will be set by caller if needed
      byRegime,
    };
  }

  /**
   * Compute performance segmented by market regime.
   */
  private computeByRegime(trades: TradeRecord[]): PerfWindow['byRegime'] {
    const regimes: RegimeTag[] = ['BULL', 'BEAR', 'CHOP', 'UNKNOWN'];
    
    const result: PerfWindow['byRegime'] = {
      BULL: { trades: 0, winRate: 0, expectancy: 0 },
      BEAR: { trades: 0, winRate: 0, expectancy: 0 },
      CHOP: { trades: 0, winRate: 0, expectancy: 0 },
      UNKNOWN: { trades: 0, winRate: 0, expectancy: 0 },
    };

    // Group trades by regime
    const byRegimeMap: Record<RegimeTag, TradeRecord[]> = {
      BULL: [],
      BEAR: [],
      CHOP: [],
      UNKNOWN: [],
    };

    for (const t of trades) {
      const rg = t.tags?.regime ?? 'UNKNOWN';
      byRegimeMap[rg].push(t);
    }

    // Calculate metrics for each regime
    for (const rg of regimes) {
      const arr = byRegimeMap[rg];
      const k = arr.length;
      
      if (k === 0) {
        result[rg] = { trades: 0, winRate: 0, expectancy: 0 };
        continue;
      }

      const w = arr.filter(x => x.win).length;
      const e = arr.reduce((a, b) => a + b.pnlPct, 0) / k;
      
      result[rg] = {
        trades: k,
        winRate: w / k,
        expectancy: e,
      };
    }

    return result;
  }

  /**
   * Create empty performance window.
   */
  private emptyWindow(horizon: Horizon, days: number): PerfWindow {
    return {
      horizon,
      days,
      trades: 0,
      winRate: 0,
      expectancy: 0,
      avgR: 0,
      sharpeLike: 0,
      maxDD: 0,
      holdRate: 0,
      byRegime: {
        BULL: { trades: 0, winRate: 0, expectancy: 0 },
        BEAR: { trades: 0, winRate: 0, expectancy: 0 },
        CHOP: { trades: 0, winRate: 0, expectancy: 0 },
        UNKNOWN: { trades: 0, winRate: 0, expectancy: 0 },
      },
    };
  }

  /**
   * Compute rolling windows for multiple time periods.
   */
  computeRolling(
    records: TradeRecord[],
    horizon: Horizon,
    windowSizes: number[] = [7, 14, 30, 60, 90, 180, 365]
  ): Record<number, PerfWindow> {
    const result: Record<number, PerfWindow> = {};
    
    for (const days of windowSizes) {
      result[days] = this.compute(records, horizon, days);
    }
    
    return result;
  }

  /**
   * Compare two sets of trade records (e.g., shadow vs active).
   */
  compare(
    activeRecords: TradeRecord[],
    shadowRecords: TradeRecord[],
    horizon: Horizon,
    days: number
  ): {
    active: PerfWindow;
    shadow: PerfWindow;
    delta: {
      winRate: number;
      expectancy: number;
      sharpeLike: number;
      maxDD: number;
    };
    shadowBetter: boolean;
  } {
    const active = this.compute(activeRecords, horizon, days);
    const shadow = this.compute(shadowRecords, horizon, days);

    const delta = {
      winRate: shadow.winRate - active.winRate,
      expectancy: shadow.expectancy - active.expectancy,
      sharpeLike: shadow.sharpeLike - active.sharpeLike,
      maxDD: shadow.maxDD - active.maxDD, // Negative = shadow better
    };

    // Shadow is better if:
    // - Higher expectancy OR higher Sharpe
    // - AND not significantly worse drawdown
    const shadowBetter = 
      (delta.expectancy > 0 || delta.sharpeLike > 0.1) &&
      delta.maxDD <= 0.05; // Max 5% worse drawdown

    return { active, shadow, delta, shadowBetter };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let instance: ExchangeTradePerfService | null = null;

export function getExchangeTradePerfService(): ExchangeTradePerfService {
  if (!instance) {
    instance = new ExchangeTradePerfService();
  }
  return instance;
}

console.log('[Exchange ML] Trade perf service loaded');
