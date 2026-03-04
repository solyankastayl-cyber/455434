/**
 * P4: Composite Volatility Service
 * 
 * Calculates volatility penalty for each asset.
 * Uses historical candles to compute realized volatility.
 * 
 * Vol penalty formula:
 *   v_a = 1 / (1 + (sigma_a / sigma_ref)^p)
 * 
 * Where:
 *   sigma_a = stdev of daily log returns
 *   sigma_ref = reference volatility (default 2%)
 *   p = penalty power (default 1.5)
 */

export interface VolatilityResult {
  asset: string;
  sigma: number;          // Realized volatility (daily)
  penalty: number;        // Vol penalty factor (0..1]
  lookbackDays: number;
  samplesUsed: number;
}

/**
 * Calculate daily log returns from prices
 */
export function calculateLogReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return returns;
}

/**
 * Calculate standard deviation
 */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Calculate volatility from price series
 */
export function calculateVolatility(prices: number[], lookbackDays: number): { sigma: number; samplesUsed: number } {
  // Use last `lookbackDays` prices
  const recentPrices = prices.slice(-lookbackDays);
  
  if (recentPrices.length < 5) {
    return { sigma: 0.02, samplesUsed: 0 }; // Default to 2% if insufficient data
  }
  
  const returns = calculateLogReturns(recentPrices);
  const sigma = stdev(returns);
  
  return { sigma, samplesUsed: returns.length };
}

/**
 * Calculate volatility penalty
 * 
 * Higher volatility = lower penalty (reduces weight)
 * v_a = 1 / (1 + (sigma / sigma_ref)^p)
 */
export function calculateVolPenalty(
  sigma: number,
  sigmaRef: number = 0.02,
  power: number = 1.5
): number {
  if (sigma <= 0 || sigmaRef <= 0) return 1.0;
  
  const ratio = sigma / sigmaRef;
  const penalty = 1 / (1 + Math.pow(ratio, power));
  
  // Ensure bounded (0..1]
  return Math.max(0.01, Math.min(1.0, penalty));
}

/**
 * Calculate volatility results for all assets
 */
export function calculateVolatilityResults(
  btcPrices: number[],
  spxPrices: number[],
  dxyPrices: number[],
  lookbackDays: number = 30,
  sigmaRef: number = 0.02,
  power: number = 1.5
): {
  BTC: VolatilityResult;
  SPX: VolatilityResult;
  DXY: VolatilityResult;
} {
  const btcVol = calculateVolatility(btcPrices, lookbackDays);
  const spxVol = calculateVolatility(spxPrices, lookbackDays);
  const dxyVol = calculateVolatility(dxyPrices, lookbackDays);
  
  return {
    BTC: {
      asset: 'BTC',
      sigma: btcVol.sigma,
      penalty: calculateVolPenalty(btcVol.sigma, sigmaRef, power),
      lookbackDays,
      samplesUsed: btcVol.samplesUsed,
    },
    SPX: {
      asset: 'SPX',
      sigma: spxVol.sigma,
      penalty: calculateVolPenalty(spxVol.sigma, sigmaRef, power),
      lookbackDays,
      samplesUsed: spxVol.samplesUsed,
    },
    DXY: {
      asset: 'DXY',
      sigma: dxyVol.sigma,
      penalty: calculateVolPenalty(dxyVol.sigma, sigmaRef, power),
      lookbackDays,
      samplesUsed: dxyVol.samplesUsed,
    },
  };
}

export default {
  calculateLogReturns,
  stdev,
  calculateVolatility,
  calculateVolPenalty,
  calculateVolatilityResults,
};
