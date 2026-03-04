/**
 * P14: Rolling Metrics & Performance Matrix Service
 */

import type { RollingPack, RollingPoint, PerformanceMatrix } from '../contracts/rolling.contract.js';
import { calculatePerfStats, calculateRollingVol } from './perf_stats.service.js';
import { getBacktestRunnerService } from '../../backtest/services/backtest_runner.service.js';
import { getRegimeDecompositionService } from './regime_decomposition.service.js';
import { getVolatilityDecompositionService } from './volatility_decomposition.service.js';

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

class PerformanceMatrixService {
  
  /**
   * Calculate rolling metrics (6m or 12m window)
   */
  async calculateRolling(backtestId: string, window: '6m' | '12m'): Promise<RollingPack | null> {
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
    const windowSize = window === '12m' 
      ? (strategy.config.step === '1w' ? 52 : 252)
      : (strategy.config.step === '1w' ? 26 : 126);
    
    const stratReturns = strategy.series.returns || [];
    const baseReturns = baseline.series.returns || [];
    const dates = strategy.series.dates || [];
    
    const points: RollingPoint[] = [];
    
    for (let i = windowSize; i < stratReturns.length; i++) {
      const windowStratReturns = stratReturns.slice(i - windowSize, i);
      const windowBaseReturns = baseReturns.slice(i - windowSize, i);
      
      const stratStats = calculatePerfStats({
        returns: windowStratReturns,
        annualizationFactor,
      });
      
      const baseStats = calculatePerfStats({
        returns: windowBaseReturns,
        annualizationFactor,
      });
      
      // Calculate vol
      const stratVol = this.calcVol(windowStratReturns, annualizationFactor);
      const baseVol = this.calcVol(windowBaseReturns, annualizationFactor);
      
      points.push({
        asOf: dates[i] || '',
        strategy: {
          sharpe: stratStats.sharpe,
          maxDD: stratStats.maxDD,
          vol: stratVol,
        },
        baseline: {
          sharpe: baseStats.sharpe,
          maxDD: baseStats.maxDD,
          vol: baseVol,
        },
        delta: {
          sharpe: round4(stratStats.sharpe - baseStats.sharpe),
          maxDD: round4(stratStats.maxDD - baseStats.maxDD),
        },
      });
    }
    
    // Calculate stability metrics
    const deltaSharpes = points.map(p => p.delta.sharpe);
    const avgDeltaSharpe = deltaSharpes.reduce((a, b) => a + b, 0) / deltaSharpes.length;
    const minDeltaSharpe = Math.min(...deltaSharpes);
    const maxDeltaSharpe = Math.max(...deltaSharpes);
    const pctNegativeDelta = deltaSharpes.filter(d => d < 0).length / deltaSharpes.length;
    const pctBadDelta = deltaSharpes.filter(d => d < -0.15).length / deltaSharpes.length;
    
    return {
      backtestId,
      window,
      points,
      stability: {
        avgDeltaSharpe: round4(avgDeltaSharpe),
        minDeltaSharpe: round4(minDeltaSharpe),
        maxDeltaSharpe: round4(maxDeltaSharpe),
        pctNegativeDelta: round4(pctNegativeDelta),
        pctBadDelta: round4(pctBadDelta),
      },
    };
  }
  
  private calcVol(returns: number[], annualizationFactor: number): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return round4(Math.sqrt(variance) * Math.sqrt(annualizationFactor));
  }
  
  /**
   * Calculate full performance matrix with gates
   */
  async calculateMatrix(backtestId: string): Promise<PerformanceMatrix | null> {
    const regimeService = getRegimeDecompositionService();
    const volService = getVolatilityDecompositionService();
    
    // Get regime and vol decompositions
    const [regimePack, volPack, rolling] = await Promise.all([
      regimeService.calculateRegimePerformance(backtestId),
      volService.calculateVolPerformance(backtestId),
      this.calculateRolling(backtestId, '12m'),
    ]);
    
    if (!regimePack || !volPack || !rolling) {
      return null;
    }
    
    // Build matrix (simplified: regime x vol bucket)
    const matrix: PerformanceMatrix['matrix'] = [];
    
    // Add regime slices to matrix
    for (const slice of regimePack.slices) {
      if (slice.key.type === 'scenario') {
        matrix.push({
          macroRegime: slice.key.scenario,
          volBucket: 'ALL',
          n: slice.strategy.n,
          deltaSharpe: slice.delta.sharpe,
          deltaMaxDD: slice.delta.maxDD,
          deltaCagr: slice.delta.cagr,
        });
      }
    }
    
    // Add vol buckets to matrix
    for (const bucket of volPack.buckets) {
      matrix.push({
        macroRegime: 'ALL',
        volBucket: bucket.bucket,
        n: bucket.strategy.n,
        deltaSharpe: bucket.delta.sharpe,
        deltaMaxDD: bucket.delta.maxDD,
        deltaCagr: bucket.delta.cagr,
      });
    }
    
    // Evaluate gates
    const gates = this.evaluateGates(regimePack, volPack, rolling);
    
    // Determine verdict
    let verdict: 'PASS' | 'FAIL' | 'REVIEW' = 'PASS';
    const reasons: string[] = [];
    
    if (!gates.riskProtection) {
      verdict = 'FAIL';
      reasons.push('Gate A failed: No risk protection in HIGH VOL or TAIL');
    }
    
    if (!gates.noBaseUnderperform) {
      if (verdict !== 'FAIL') verdict = 'REVIEW';
      reasons.push('Gate B warning: Underperformance in BASE regime');
    }
    
    if (!gates.stability) {
      if (verdict !== 'FAIL') verdict = 'REVIEW';
      reasons.push('Gate C warning: Rolling Sharpe unstable (>25% bad periods)');
    }
    
    if (reasons.length === 0) {
      reasons.push('All institutional gates passed');
    }
    
    return {
      backtestId,
      matrix,
      overallVerdict: verdict,
      gates,
      reasons,
    };
  }
  
  private evaluateGates(
    regimePack: any,
    volPack: any,
    rolling: RollingPack
  ): PerformanceMatrix['gates'] {
    // Gate A: Risk protection in HIGH VOL or TAIL
    let riskProtection = false;
    
    // Check TAIL regime
    const tailSlice = regimePack.slices.find((s: any) => 
      s.key.type === 'scenario' && s.key.scenario === 'TAIL'
    );
    if (tailSlice && (tailSlice.delta.maxDD < -0.005 || tailSlice.delta.tailLoss99 > 0.0015)) {
      riskProtection = true;
    }
    
    // Check HIGH VOL bucket
    const highVolBucket = volPack.buckets.find((b: any) => b.bucket === 'HIGH');
    if (highVolBucket && (highVolBucket.delta.maxDD < -0.005 || highVolBucket.delta.tailLoss99 > 0.0015)) {
      riskProtection = true;
    }
    
    // Gate B: No catastrophic underperformance in BASE
    let noBaseUnderperform = true;
    const baseSlice = regimePack.slices.find((s: any) => 
      s.key.type === 'scenario' && s.key.scenario === 'BASE'
    );
    if (baseSlice) {
      if (baseSlice.delta.sharpe < -0.10 || baseSlice.delta.cagr < -0.008) {
        noBaseUnderperform = false;
      }
    }
    
    // Gate C: Rolling stability
    const stability = rolling.stability.pctBadDelta < 0.25;
    
    return {
      riskProtection,
      noBaseUnderperform,
      stability,
    };
  }
}

let instance: PerformanceMatrixService | null = null;

export function getPerformanceMatrixService(): PerformanceMatrixService {
  if (!instance) {
    instance = new PerformanceMatrixService();
  }
  return instance;
}

export { PerformanceMatrixService };
