/**
 * BLOCK 56.4 — Forward Equity Metrics Utils
 * 
 * Pure functions for calculating performance metrics:
 * - CAGR, Sharpe, MaxDD
 * - Win Rate, Expectancy, Profit Factor
 * - Volatility
 */

export type DDPoint = { t: string; value: number };
export type RetPoint = { t: string; value: number };

/**
 * Calculate Maximum Drawdown from equity series
 */
export function calcMaxDD(equity: DDPoint[]): number {
  if (equity.length === 0) return 0;
  
  let peak = equity[0].value;
  let maxDD = 0;
  
  for (const p of equity) {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? (peak - p.value) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  
  return maxDD;
}

/**
 * Calculate mean of array
 */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Calculate standard deviation
 */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Calculate CAGR (Compound Annual Growth Rate)
 */
export function calcCAGR(equityStart: number, equityEnd: number, daysElapsed: number): number {
  if (daysElapsed <= 0) return 0;
  if (equityStart <= 0 || equityEnd <= 0) return 0;
  return Math.pow(equityEnd / equityStart, 365 / daysElapsed) - 1;
}

/**
 * Calculate Sharpe ratio
 */
export function calcSharpe(returns: number[], annualFactor: number): number {
  const s = stdev(returns);
  if (s === 0) return 0;
  return (mean(returns) / s) * Math.sqrt(annualFactor);
}

/**
 * Calculate Profit Factor
 */
export function calcProfitFactor(pnls: number[]): number {
  const pos = pnls.filter(x => x > 0).reduce((a, b) => a + b, 0);
  const neg = pnls.filter(x => x < 0).reduce((a, b) => a + b, 0);
  if (neg === 0) return pos > 0 ? 999 : 0;
  return pos / Math.abs(neg);
}

/**
 * Calculate days between two date strings
 */
export function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((db - da) / (1000 * 60 * 60 * 24)));
}
