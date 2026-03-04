/**
 * P14: Regime Decomposition Service
 * Breaks down performance by Brain scenario, macro regime, guard level
 */

import type { 
  RegimePerformancePack, 
  PerformanceSlice,
  Scenario,
  SliceKey,
} from '../contracts/regime_performance.contract.js';
import { calculatePerfStats, calculateDelta } from './perf_stats.service.js';
import { getBacktestRunnerService } from '../../backtest/services/backtest_runner.service.js';

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export interface TimelinePoint {
  date: string;
  strategyReturn: number;
  baselineReturn: number;
  strategyAlloc: { spx: number; btc: number; cash: number };
  baselineAlloc: { spx: number; btc: number; cash: number };
  scenario: Scenario;
  macroRegime?: string;
  guard?: string;
  crossAsset?: string;
}

class RegimeDecompositionService {
  
  /**
   * Calculate regime-based performance decomposition
   */
  async calculateRegimePerformance(backtestId: string): Promise<RegimePerformancePack | null> {
    const backtest = getBacktestRunnerService();
    
    // Get compare result
    const compare = backtest.getCompareStatus(backtestId);
    if (!compare || compare.status !== 'done') {
      return null;
    }
    
    const strategy = compare.strategy;
    const baseline = compare.baseline;
    
    if (!strategy?.series || !baseline?.series) {
      return null;
    }
    
    // Build timeline from series
    const timeline = this.buildTimeline(strategy, baseline);
    const annualizationFactor = strategy.config.step === '1w' ? 52 : 252;
    
    // Calculate slices by scenario
    const scenarioSlices = this.calculateScenarioSlices(timeline, annualizationFactor);
    
    // Combine all slices
    const slices = [...scenarioSlices];
    
    // Summary
    const totalStrategy = calculatePerfStats({
      returns: timeline.map(t => t.strategyReturn),
      allocations: timeline.map(t => t.strategyAlloc),
      annualizationFactor,
    });
    const totalBaseline = calculatePerfStats({
      returns: timeline.map(t => t.baselineReturn),
      allocations: timeline.map(t => t.baselineAlloc),
      annualizationFactor,
    });
    
    return {
      backtestId,
      period: {
        start: strategy.config.start,
        end: strategy.config.end,
        freq: strategy.config.step === '1w' ? 'weekly' : 'daily',
      },
      slices,
      summary: {
        totalPeriods: timeline.length,
        strategyWinsRisk: totalStrategy.maxDD < totalBaseline.maxDD,
        baselineWinsReturn: totalBaseline.cagr > totalStrategy.cagr,
      },
      notes: {
        costBps: strategy.config.costs.feeBps + strategy.config.costs.slippageBps,
        annualizationFactor,
      },
    };
  }
  
  private buildTimeline(strategy: any, baseline: any): TimelinePoint[] {
    const timeline: TimelinePoint[] = [];
    const n = Math.min(
      strategy.series?.returns?.length || 0,
      baseline.series?.returns?.length || 0
    );
    
    for (let i = 0; i < n; i++) {
      const scenario = strategy.series.scenario?.[i] || 'BASE';
      
      timeline.push({
        date: strategy.series.dates?.[i] || '',
        strategyReturn: strategy.series.returns[i] || 0,
        baselineReturn: baseline.series.returns[i] || 0,
        strategyAlloc: {
          spx: strategy.series.weights?.spx?.[i] || 0,
          btc: strategy.series.weights?.btc?.[i] || 0,
          cash: strategy.series.weights?.cash?.[i] || 0,
        },
        baselineAlloc: {
          spx: baseline.series.weights?.spx?.[i] || 0,
          btc: baseline.series.weights?.btc?.[i] || 0,
          cash: baseline.series.weights?.cash?.[i] || 0,
        },
        scenario: scenario as Scenario,
      });
    }
    
    return timeline;
  }
  
  private calculateScenarioSlices(
    timeline: TimelinePoint[],
    annualizationFactor: number
  ): PerformanceSlice[] {
    const scenarios: Scenario[] = ['BASE', 'RISK', 'TAIL'];
    const slices: PerformanceSlice[] = [];
    
    for (const scenario of scenarios) {
      const filtered = timeline.filter(t => t.scenario === scenario);
      
      if (filtered.length < 2) {
        continue;
      }
      
      const strategyStats = calculatePerfStats({
        returns: filtered.map(t => t.strategyReturn),
        allocations: filtered.map(t => t.strategyAlloc),
        annualizationFactor,
      });
      
      const baselineStats = calculatePerfStats({
        returns: filtered.map(t => t.baselineReturn),
        allocations: filtered.map(t => t.baselineAlloc),
        annualizationFactor,
      });
      
      slices.push({
        key: { type: 'scenario', scenario },
        strategy: strategyStats,
        baseline: baselineStats,
        delta: calculateDelta(strategyStats, baselineStats),
      });
    }
    
    return slices;
  }
}

let instance: RegimeDecompositionService | null = null;

export function getRegimeDecompositionService(): RegimeDecompositionService {
  if (!instance) {
    instance = new RegimeDecompositionService();
  }
  return instance;
}

export { RegimeDecompositionService };
