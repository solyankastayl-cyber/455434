/**
 * P14: Volatility Decomposition Service
 * Breaks down performance by volatility regime (LOW/MID/HIGH)
 */

import type { 
  VolatilityPerformancePack, 
  VolatilityBucket,
  VolBucket,
} from '../contracts/volatility_performance.contract.js';
import { calculatePerfStats, calculateDelta, calculateRollingVol } from './perf_stats.service.js';
import { getBacktestRunnerService } from '../../backtest/services/backtest_runner.service.js';

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

class VolatilityDecompositionService {
  
  /**
   * Calculate volatility-based performance decomposition
   */
  async calculateVolPerformance(
    backtestId: string,
    windowDays: number = 30,
    quantileLow: number = 0.3,
    quantileHigh: number = 0.7
  ): Promise<VolatilityPerformancePack | null> {
    const backtest = getBacktestRunnerService();
    
    const compare = backtest.getCompareStatus(backtestId);
    if (!compare || compare.status !== 'done') {
      return null;
    }
    
    const strategy = compare.strategy;
    const baseline = compare.baseline;
    
    if (!strategy?.series || !baseline?.series) {
      return null;
    }
    
    const annualizationFactor = strategy.config.step === '1w' ? 52 : 252;
    const windowSize = strategy.config.step === '1w' ? Math.ceil(windowDays / 7) : windowDays;
    
    // Calculate rolling vol from strategy returns (portfolio vol)
    const returns = strategy.series.returns || [];
    const vols = calculateRollingVol(returns, windowSize, annualizationFactor);
    
    // Filter out zero vols (beginning of series)
    const validVols = vols.filter(v => v > 0);
    if (validVols.length < 10) {
      return null;
    }
    
    // Calculate quantile bounds
    const sortedVols = [...validVols].sort((a, b) => a - b);
    const loThreshold = sortedVols[Math.floor(sortedVols.length * quantileLow)];
    const hiThreshold = sortedVols[Math.floor(sortedVols.length * quantileHigh)];
    
    // Classify each period
    const bucketData: Record<VolBucket, { 
      stratReturns: number[];
      baseReturns: number[];
      stratAllocs: any[];
      baseAllocs: any[];
      bounds: { lo: number; hi: number };
    }> = {
      LOW: { stratReturns: [], baseReturns: [], stratAllocs: [], baseAllocs: [], bounds: { lo: 0, hi: loThreshold } },
      MID: { stratReturns: [], baseReturns: [], stratAllocs: [], baseAllocs: [], bounds: { lo: loThreshold, hi: hiThreshold } },
      HIGH: { stratReturns: [], baseReturns: [], stratAllocs: [], baseAllocs: [], bounds: { lo: hiThreshold, hi: 1 } },
    };
    
    for (let i = 0; i < returns.length; i++) {
      const vol = vols[i];
      if (vol === 0) continue;
      
      let bucket: VolBucket;
      if (vol <= loThreshold) bucket = 'LOW';
      else if (vol >= hiThreshold) bucket = 'HIGH';
      else bucket = 'MID';
      
      bucketData[bucket].stratReturns.push(returns[i]);
      bucketData[bucket].baseReturns.push(baseline.series.returns[i] || 0);
      
      bucketData[bucket].stratAllocs.push({
        spx: strategy.series.weights?.spx?.[i] || 0,
        btc: strategy.series.weights?.btc?.[i] || 0,
        cash: strategy.series.weights?.cash?.[i] || 0,
      });
      bucketData[bucket].baseAllocs.push({
        spx: baseline.series.weights?.spx?.[i] || 0,
        btc: baseline.series.weights?.btc?.[i] || 0,
        cash: baseline.series.weights?.cash?.[i] || 0,
      });
    }
    
    // Calculate stats for each bucket
    const buckets: VolatilityBucket[] = [];
    const deltas: Record<VolBucket, number> = { LOW: 0, MID: 0, HIGH: 0 };
    
    for (const bucket of ['LOW', 'MID', 'HIGH'] as VolBucket[]) {
      const data = bucketData[bucket];
      
      if (data.stratReturns.length < 2) {
        continue;
      }
      
      const strategyStats = calculatePerfStats({
        returns: data.stratReturns,
        allocations: data.stratAllocs,
        annualizationFactor,
      });
      
      const baselineStats = calculatePerfStats({
        returns: data.baseReturns,
        allocations: data.baseAllocs,
        annualizationFactor,
      });
      
      const delta = calculateDelta(strategyStats, baselineStats);
      deltas[bucket] = delta.sharpe;
      
      buckets.push({
        bucket,
        bounds: data.bounds,
        strategy: strategyStats,
        baseline: baselineStats,
        delta,
      });
    }
    
    return {
      backtestId,
      volSpec: {
        windowDays,
        asset: 'portfolio',
        bucketQuantiles: [quantileLow, quantileHigh],
      },
      buckets,
      insight: {
        strategyBetterInHighVol: deltas.HIGH > 0,
        strategyWorseInLowVol: deltas.LOW < 0,
        volatilityEdge: round4(deltas.HIGH - deltas.LOW),
      },
    };
  }
}

let instance: VolatilityDecompositionService | null = null;

export function getVolatilityDecompositionService(): VolatilityDecompositionService {
  if (!instance) {
    instance = new VolatilityDecompositionService();
  }
  return instance;
}

export { VolatilityDecompositionService };
