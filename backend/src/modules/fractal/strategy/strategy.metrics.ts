/**
 * BLOCK 56 — Strategy Metrics Calculator
 * 
 * Pure functions for calculating performance metrics:
 * - Sharpe, CAGR, MaxDD
 * - Trades, WinRate, Expectancy
 * - TimeInMarket, AvgPosition
 */

export interface EquityPoint {
  t: Date;
  equity: number;
  position: number;
  dailyReturn: number;
}

export interface Trade {
  entryDate: Date;
  exitDate: Date;
  entryPrice: number;
  exitPrice: number;
  positionSize: number;
  pnl: number;
  pnlPct: number;
}

export interface MetricsResult {
  cagr: number;
  sharpe: number;
  maxDD: number;
  maxDDStart: Date | null;
  maxDDEnd: Date | null;
  trades: number;
  avgPosition: number;
  winRate: number;
  expectancy: number;
  timeInMarket: number;
  totalReturn: number;
  volatility: number;
}

/**
 * Calculate annualized Sharpe ratio
 * @param dailyReturns Array of daily returns (decimal, not %)
 * @param annualization Days per year (default 365)
 */
export function calcSharpe(dailyReturns: number[], annualization = 365): number {
  if (dailyReturns.length < 2) return 0;
  
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  const std = Math.sqrt(variance);
  
  if (std < 1e-10) return 0;
  
  return (mean / std) * Math.sqrt(annualization);
}

/**
 * Calculate CAGR (Compound Annual Growth Rate)
 */
export function calcCagr(equitySeries: EquityPoint[]): number {
  if (equitySeries.length < 2) return 0;
  
  const first = equitySeries[0];
  const last = equitySeries[equitySeries.length - 1];
  
  const startEq = first.equity;
  const endEq = last.equity;
  
  const daysElapsed = (last.t.getTime() - first.t.getTime()) / (1000 * 60 * 60 * 24);
  const yearsElapsed = daysElapsed / 365;
  
  if (yearsElapsed < 0.01 || startEq <= 0) return 0;
  
  return Math.pow(endEq / startEq, 1 / yearsElapsed) - 1;
}

/**
 * Calculate Maximum Drawdown
 * Returns { maxDD, maxDDStart, maxDDEnd }
 */
export function calcMaxDD(equitySeries: EquityPoint[]): { 
  maxDD: number; 
  maxDDStart: Date | null; 
  maxDDEnd: Date | null;
} {
  if (equitySeries.length < 2) {
    return { maxDD: 0, maxDDStart: null, maxDDEnd: null };
  }
  
  let peak = equitySeries[0].equity;
  let peakIdx = 0;
  let maxDD = 0;
  let maxDDStart: Date | null = null;
  let maxDDEnd: Date | null = null;
  
  for (let i = 1; i < equitySeries.length; i++) {
    const eq = equitySeries[i].equity;
    
    if (eq > peak) {
      peak = eq;
      peakIdx = i;
    } else {
      const dd = (peak - eq) / peak;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDStart = equitySeries[peakIdx].t;
        maxDDEnd = equitySeries[i].t;
      }
    }
  }
  
  return { maxDD, maxDDStart, maxDDEnd };
}

/**
 * Count trades based on position changes
 * @param positionSeries Array of positions
 * @param threshold Minimum change to count as trade (default 0.05 = 5%)
 */
export function calcTrades(positionSeries: number[], threshold = 0.05): number {
  if (positionSeries.length < 2) return 0;
  
  let trades = 0;
  let prevPos = positionSeries[0];
  
  for (let i = 1; i < positionSeries.length; i++) {
    const currPos = positionSeries[i];
    const delta = Math.abs(currPos - prevPos);
    
    if (delta >= threshold) {
      trades++;
      prevPos = currPos;
    }
  }
  
  return trades;
}

/**
 * Calculate win rate from trades
 */
export function calcWinRate(trades: Trade[]): number {
  if (trades.length === 0) return 0;
  
  const wins = trades.filter(t => t.pnl > 0).length;
  return wins / trades.length;
}

/**
 * Calculate expectancy (average PnL per trade)
 */
export function calcExpectancy(trades: Trade[]): number {
  if (trades.length === 0) return 0;
  
  const totalPnl = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  return totalPnl / trades.length;
}

/**
 * Calculate time in market (% of days with position > threshold)
 */
export function calcTimeInMarket(positionSeries: number[], threshold = 0.01): number {
  if (positionSeries.length === 0) return 0;
  
  const activeDays = positionSeries.filter(p => p > threshold).length;
  return activeDays / positionSeries.length;
}

/**
 * Calculate average position size
 */
export function calcAvgPosition(positionSeries: number[]): number {
  if (positionSeries.length === 0) return 0;
  
  const sum = positionSeries.reduce((a, b) => a + b, 0);
  return sum / positionSeries.length;
}

/**
 * Calculate annualized volatility
 */
export function calcVolatility(dailyReturns: number[], annualization = 365): number {
  if (dailyReturns.length < 2) return 0;
  
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  
  return Math.sqrt(variance * annualization);
}

/**
 * Calculate all metrics from equity series
 */
export function calcAllMetrics(
  equitySeries: EquityPoint[],
  trades: Trade[]
): MetricsResult {
  const dailyReturns = equitySeries.map(e => e.dailyReturn);
  const positions = equitySeries.map(e => e.position);
  
  const { maxDD, maxDDStart, maxDDEnd } = calcMaxDD(equitySeries);
  
  const first = equitySeries[0]?.equity ?? 1;
  const last = equitySeries[equitySeries.length - 1]?.equity ?? 1;
  
  return {
    cagr: calcCagr(equitySeries),
    sharpe: calcSharpe(dailyReturns),
    maxDD,
    maxDDStart,
    maxDDEnd,
    trades: trades.length,
    avgPosition: calcAvgPosition(positions),
    winRate: calcWinRate(trades),
    expectancy: calcExpectancy(trades),
    timeInMarket: calcTimeInMarket(positions),
    totalReturn: (last - first) / first,
    volatility: calcVolatility(dailyReturns)
  };
}

/**
 * Format metrics for display
 */
export function formatMetrics(m: MetricsResult): Record<string, string> {
  return {
    cagr: `${(m.cagr * 100).toFixed(1)}%`,
    sharpe: m.sharpe.toFixed(2),
    maxDD: `${(m.maxDD * 100).toFixed(1)}%`,
    trades: m.trades.toString(),
    avgPosition: `${(m.avgPosition * 100).toFixed(0)}%`,
    winRate: `${(m.winRate * 100).toFixed(0)}%`,
    expectancy: `${(m.expectancy * 100).toFixed(2)}%`,
    timeInMarket: `${(m.timeInMarket * 100).toFixed(0)}%`,
    totalReturn: `${(m.totalReturn * 100).toFixed(1)}%`,
    volatility: `${(m.volatility * 100).toFixed(1)}%`
  };
}
