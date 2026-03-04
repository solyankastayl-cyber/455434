/**
 * P13: Metrics Service
 * CAGR, Sharpe, MaxDD, Sortino, Calmar, VaR
 */

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export interface MetricsInput {
  returns: number[];     // Period returns (daily or weekly)
  periodsPerYear: number; // 252 for daily, 52 for weekly
  riskFreeRate?: number;  // Annual, default 0
}

export interface MetricsOutput {
  cagr: number;
  volAnn: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  tailLoss95: number;
  tailLoss99: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
}

export function calculateMetrics(input: MetricsInput): MetricsOutput {
  const { returns, periodsPerYear, riskFreeRate = 0 } = input;
  const n = returns.length;
  
  if (n < 2) {
    return {
      cagr: 0, volAnn: 0, sharpe: 0, sortino: 0,
      maxDrawdown: 0, calmar: 0, tailLoss95: 0, tailLoss99: 0,
      winRate: 0, avgReturn: 0, totalReturn: 0,
    };
  }
  
  // Total return (compounded)
  let equity = 1;
  const equityCurve: number[] = [1];
  for (const r of returns) {
    equity *= (1 + r);
    equityCurve.push(equity);
  }
  const totalReturn = equity - 1;
  
  // CAGR
  const years = n / periodsPerYear;
  const cagr = years > 0 ? Math.pow(equity, 1 / years) - 1 : 0;
  
  // Mean and volatility
  const meanReturn = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const volAnn = stdDev * Math.sqrt(periodsPerYear);
  
  // Sharpe
  const rfPerPeriod = riskFreeRate / periodsPerYear;
  const excessReturn = meanReturn - rfPerPeriod;
  const sharpe = stdDev > 0 ? (excessReturn / stdDev) * Math.sqrt(periodsPerYear) : 0;
  
  // Sortino (downside deviation)
  const negReturns = returns.filter(r => r < rfPerPeriod);
  const downsideVar = negReturns.length > 0 
    ? negReturns.reduce((sum, r) => sum + Math.pow(r - rfPerPeriod, 2), 0) / negReturns.length
    : 0;
  const downsideDev = Math.sqrt(downsideVar);
  const sortino = downsideDev > 0 ? (excessReturn / downsideDev) * Math.sqrt(periodsPerYear) : 0;
  
  // Max Drawdown
  let maxDD = 0;
  let peak = equityCurve[0];
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  
  // Calmar
  const calmar = maxDD > 0 ? cagr / maxDD : 0;
  
  // Tail losses (VaR historical)
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const idx95 = Math.floor(n * 0.05);
  const idx99 = Math.floor(n * 0.01);
  const tailLoss95 = sortedReturns[idx95] || sortedReturns[0];
  const tailLoss99 = sortedReturns[idx99] || sortedReturns[0];
  
  // Win rate
  const wins = returns.filter(r => r > 0).length;
  const winRate = wins / n;
  
  return {
    cagr: round4(cagr),
    volAnn: round4(volAnn),
    sharpe: round4(sharpe),
    sortino: round4(sortino),
    maxDrawdown: round4(maxDD),
    calmar: round4(calmar),
    tailLoss95: round4(tailLoss95),
    tailLoss99: round4(tailLoss99),
    winRate: round4(winRate),
    avgReturn: round4(meanReturn),
    totalReturn: round4(totalReturn),
  };
}

/**
 * Calculate turnover between two weight vectors
 */
export function calculateTurnover(
  prevWeights: Record<string, number>,
  newWeights: Record<string, number>
): number {
  let turnover = 0;
  const allAssets = new Set([...Object.keys(prevWeights), ...Object.keys(newWeights)]);
  
  for (const asset of allAssets) {
    const prev = prevWeights[asset] || 0;
    const curr = newWeights[asset] || 0;
    turnover += Math.abs(curr - prev);
  }
  
  return round4(turnover);
}

/**
 * Calculate transaction cost
 */
export function calculateCost(turnover: number, feeBps: number, slippageBps: number): number {
  return turnover * (feeBps + slippageBps) / 10000;
}

/**
 * Generate determinism hash for audit
 */
export function generateDeterminismHash(seed: number, returns: number[]): string {
  // Simple hash based on seed and first/last returns
  const data = `${seed}_${returns[0]?.toFixed(6)}_${returns[returns.length - 1]?.toFixed(6)}_${returns.length}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
