/**
 * P14: Performance Stats Calculator
 * Core metrics: CAGR, Sharpe, MaxDD, TailLoss99
 */

import type { PerfStats } from '../contracts/regime_performance.contract.js';

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export interface PerfStatsInput {
  returns: number[];                    // period returns (net of costs)
  allocations?: Array<{ spx: number; btc: number; cash: number }>;
  annualizationFactor: number;          // 52 for weekly, 252 for daily
}

/**
 * Calculate performance statistics for a slice of returns
 */
export function calculatePerfStats(input: PerfStatsInput): PerfStats {
  const { returns, allocations, annualizationFactor } = input;
  const n = returns.length;
  
  if (n < 2) {
    return {
      n,
      cagr: 0,
      sharpe: 0,
      maxDD: 0,
      tailLoss99: 0,
      avgExposure: 0,
      avgCash: 0,
    };
  }
  
  // Build equity curve
  let equity = 1;
  const equityCurve: number[] = [1];
  for (const r of returns) {
    equity *= (1 + r);
    equityCurve.push(equity);
  }
  
  // CAGR
  const years = n / annualizationFactor;
  const cagr = years > 0 ? Math.pow(equity, 1 / years) - 1 : 0;
  
  // Mean and std
  const meanReturn = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  
  // Sharpe (annualized)
  const sharpe = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(annualizationFactor) : 0;
  
  // MaxDD
  let maxDD = 0;
  let peak = equityCurve[0];
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  
  // TailLoss99 (1% quantile)
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor(n * 0.01));
  const tailLoss99 = sorted[idx] || sorted[0];
  
  // Avg exposure and cash
  let avgExposure = 0.5; // default
  let avgCash = 0.5;
  if (allocations && allocations.length > 0) {
    avgExposure = allocations.reduce((sum, a) => sum + (a.spx || 0) + (a.btc || 0), 0) / allocations.length;
    avgCash = allocations.reduce((sum, a) => sum + (a.cash || 0), 0) / allocations.length;
  }
  
  return {
    n,
    cagr: round4(cagr),
    sharpe: round4(sharpe),
    maxDD: round4(maxDD),
    tailLoss99: round4(tailLoss99),
    avgExposure: round4(avgExposure),
    avgCash: round4(avgCash),
  };
}

/**
 * Calculate delta between strategy and baseline
 */
export function calculateDelta(strategy: PerfStats, baseline: PerfStats) {
  return {
    cagr: round4(strategy.cagr - baseline.cagr),
    sharpe: round4(strategy.sharpe - baseline.sharpe),
    maxDD: round4(strategy.maxDD - baseline.maxDD), // negative = strategy better
    tailLoss99: round4(strategy.tailLoss99 - baseline.tailLoss99), // positive = strategy better
  };
}

/**
 * Calculate rolling volatility
 */
export function calculateRollingVol(
  returns: number[], 
  windowSize: number, 
  annualizationFactor: number
): number[] {
  const vols: number[] = [];
  
  for (let i = 0; i < returns.length; i++) {
    if (i < windowSize - 1) {
      vols.push(0);
      continue;
    }
    
    const windowReturns = returns.slice(i - windowSize + 1, i + 1);
    const mean = windowReturns.reduce((a, b) => a + b, 0) / windowSize;
    const variance = windowReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / windowSize;
    const vol = Math.sqrt(variance) * Math.sqrt(annualizationFactor);
    vols.push(round4(vol));
  }
  
  return vols;
}
