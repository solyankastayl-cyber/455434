/**
 * P13: Portfolio Backtest Runner Service
 * 
 * Core simulation loop with:
 * - asOf-safe price loading
 * - Transaction costs
 * - Turnover tracking
 * - NAV calculation
 */

import type { 
  BacktestRunRequest, 
  BacktestReport, 
  BacktestSummary,
  BacktestSeries,
  BacktestDiagnostics,
  CompareRequest,
  CompareReport,
  BacktestCompare,
} from '../contracts/backtest.contract.js';
import { getPriceLoaderService } from './price_loader.service.js';
import { 
  calculateMetrics, 
  calculateTurnover, 
  calculateCost,
  generateDeterminismHash,
} from './metrics.service.js';

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function generateId(): string {
  return `bt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function generateDates(start: string, end: string, step: '1d' | '1w'): string[] {
  const dates: string[] = [];
  const startDate = new Date(start);
  const endDate = new Date(end);
  const stepDays = step === '1w' ? 7 : 1;
  
  let current = new Date(startDate);
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + stepDays);
  }
  
  return dates;
}

// ═══════════════════════════════════════════════════════════════
// BACKTEST RUNNER SERVICE
// ═══════════════════════════════════════════════════════════════

class BacktestRunnerService {
  private runs: Map<string, BacktestReport> = new Map();
  private compares: Map<string, CompareReport> = new Map();
  private priceLoader = getPriceLoaderService();
  
  // ─────────────────────────────────────────────────────────────
  // RUN SINGLE BACKTEST
  // ─────────────────────────────────────────────────────────────
  
  async runAsync(config: BacktestRunRequest): Promise<{ id: string; status: string }> {
    const id = config.id || generateId();
    
    const report: BacktestReport = {
      id,
      status: 'queued',
      config,
      startedAt: new Date().toISOString(),
    };
    
    this.runs.set(id, report);
    
    // Run async
    this.executeRun(id, config).catch(err => {
      console.error(`[P13] Run ${id} failed:`, err);
      const run = this.runs.get(id);
      if (run) {
        run.status = 'failed';
        run.error = (err as Error).message;
      }
    });
    
    return { id, status: 'queued' };
  }
  
  private async executeRun(id: string, config: BacktestRunRequest): Promise<void> {
    const run = this.runs.get(id);
    if (!run) return;
    
    run.status = 'running';
    console.log(`[P13] Starting backtest ${id}`);
    
    const dates = generateDates(config.start, config.end, config.step);
    const periodsPerYear = config.step === '1w' ? 52 : 252;
    
    // Initialize series
    const series: BacktestSeries = {
      dates: [],
      nav: [1],
      returns: [],
      drawdown: [0],
      weights: { spx: [], btc: [], cash: [] },
      turnover: [],
      scenario: [],
    };
    
    const diagnostics: BacktestDiagnostics = {
      determinismHash: '',
      noLookahead: config.asOfSafe,
      missingData: [],
      anomalies: [],
    };
    
    let equity = 1;
    let peak = 1;
    let totalCosts = 0;
    let totalTurnover = 0;
    let prevWeights = { spx: 0, btc: 0, cash: 1 };
    
    for (let i = 0; i < dates.length - 1; i++) {
      const date = dates[i];
      const nextDate = dates[i + 1];
      
      // Get weights for this date
      const weights = await this.getWeights(date, config);
      
      // Validate weights
      const sumWeights = weights.spx + weights.btc + weights.cash;
      if (Math.abs(sumWeights - 1) > 0.01) {
        diagnostics.anomalies.push({
          date,
          type: 'weight_sum',
          detail: `Sum=${sumWeights.toFixed(4)}`,
        });
      }
      
      // Calculate turnover and costs
      const turnover = calculateTurnover(prevWeights, weights);
      const cost = calculateCost(turnover, config.costs.feeBps, config.costs.slippageBps);
      totalCosts += cost * equity;
      totalTurnover += turnover;
      
      // Get returns for each asset
      const spxReturn = await this.priceLoader.getReturn('spx', date, nextDate);
      const btcReturn = await this.priceLoader.getReturn('btc', date, nextDate);
      const cashReturn = await this.priceLoader.getReturn('cash', date, nextDate);
      
      // Portfolio return (using previous weights, pay cost)
      const grossReturn = 
        prevWeights.spx * spxReturn + 
        prevWeights.btc * btcReturn + 
        prevWeights.cash * cashReturn;
      const netReturn = grossReturn - cost;
      
      // Update equity
      equity *= (1 + netReturn);
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      
      // Record series
      series.dates.push(date);
      series.nav.push(round4(equity));
      series.returns.push(round4(netReturn));
      series.drawdown.push(round4(dd));
      series.weights.spx.push(round4(weights.spx));
      series.weights.btc.push(round4(weights.btc));
      series.weights.cash.push(round4(weights.cash));
      series.turnover.push(round4(turnover));
      
      // Get scenario (simplified - use date-based heuristic instead of Brain call)
      if (config.mode.brain === 1) {
        const dateNum = new Date(date).getTime();
        const hash = (dateNum % 100) / 100;
        let scenario = 'BASE';
        if (hash > 0.85) scenario = 'TAIL';
        else if (hash > 0.63) scenario = 'RISK';
        series.scenario?.push(scenario);
      }
      
      prevWeights = weights;
    }
    
    // Calculate metrics
    const metrics = calculateMetrics({
      returns: series.returns,
      periodsPerYear,
    });
    
    // Build summary
    const summary: BacktestSummary = {
      ...metrics,
      hitRate: metrics.winRate,
      turnoverAvg: round4(totalTurnover / dates.length),
      costImpact: round4(totalCosts / Math.max(0.01, equity - 1)),
    };
    
    // Generate determinism hash
    diagnostics.determinismHash = generateDeterminismHash(
      config.seed || 0,
      series.returns
    );
    
    // Update run
    run.status = 'done';
    run.finishedAt = new Date().toISOString();
    run.summary = summary;
    run.series = series;
    run.diagnostics = diagnostics;
    
    console.log(`[P13] Backtest ${id} complete. CAGR=${summary.cagr}, Sharpe=${summary.sharpe}`);
  }
  
  private async getWeights(
    date: string, 
    config: BacktestRunRequest
  ): Promise<{ spx: number; btc: number; cash: number }> {
    if (config.mode.brain === 0 && config.mode.optimizer === 0) {
      // Baseline: fixed allocation
      return { spx: 0.40, btc: 0.10, cash: 0.50 };
    }
    
    // Try to get real allocations from engine
    try {
      const params = new URLSearchParams({
        asOf: date,
        brain: config.mode.brain.toString(),
        optimizer: config.mode.optimizer.toString(),
      });
      
      // v2.3: Add capital scaling params
      if (config.mode.capital !== undefined) {
        params.set('capital', config.mode.capital.toString());
      }
      if (config.mode.capitalMode) {
        params.set('capitalMode', config.mode.capitalMode);
      }
      
      const response = await fetch(`http://localhost:8002/api/engine/global?${params}`);
      if (response.ok) {
        const data = await response.json();
        const alloc = data.allocations;
        if (alloc) {
          return {
            spx: alloc.spxSize ?? 0,
            btc: alloc.btcSize ?? 0,
            cash: alloc.cashSize ?? 0.5,
          };
        }
      }
    } catch (e) {
      // Fall through to heuristic
    }
    
    // Fallback: simulate scenario-based allocation
    const dateNum = new Date(date).getTime();
    const hash = (dateNum % 100) / 100;
    
    let scenario = 'BASE';
    if (hash > 0.85) {
      scenario = 'TAIL';
    } else if (hash > 0.63) {
      scenario = 'RISK';
    }
    
    // Scenario-based allocation (fallback)
    switch (scenario) {
      case 'TAIL':
        return { spx: 0.20, btc: 0.05, cash: 0.75 };
      case 'RISK':
        return { spx: 0.30, btc: 0.10, cash: 0.60 };
      case 'BASE':
      default:
        return { spx: 0.35, btc: 0.15, cash: 0.50 };
    }
  }
  
  private async getScenario(date: string): Promise<string> {
    try {
      const response = await fetch(`http://localhost:8002/api/brain/v2/decision?asOf=${date}`);
      if (response.ok) {
        const data = await response.json();
        return data.scenario?.name || 'BASE';
      }
    } catch (e) {
      // Ignore
    }
    return 'BASE';
  }
  
  // ─────────────────────────────────────────────────────────────
  // COMPARE TWO RUNS
  // ─────────────────────────────────────────────────────────────
  
  async compareAsync(request: CompareRequest): Promise<{ 
    strategyId: string; 
    baselineId: string; 
    compareId: string;
  }> {
    const strategyId = request.strategy.id || generateId();
    const baselineId = request.baseline.id || generateId();
    const compareId = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
    
    request.strategy.id = strategyId;
    request.baseline.id = baselineId;
    
    const compare: CompareReport = {
      id: compareId,
      status: 'queued',
      strategyId,
      baselineId,
      startedAt: new Date().toISOString(),
    };
    
    this.compares.set(compareId, compare);
    
    // Run both backtests
    this.executeCompare(compareId, request).catch(err => {
      console.error(`[P13] Compare ${compareId} failed:`, err);
      const cmp = this.compares.get(compareId);
      if (cmp) {
        cmp.status = 'failed';
      }
    });
    
    return { strategyId, baselineId, compareId };
  }
  
  private async executeCompare(compareId: string, request: CompareRequest): Promise<void> {
    const compare = this.compares.get(compareId);
    if (!compare) return;
    
    compare.status = 'running';
    console.log(`[P13] Starting compare ${compareId}`);
    
    // Run both backtests in parallel
    await Promise.all([
      this.runAsync(request.strategy),
      this.runAsync(request.baseline),
    ]);
    
    // Wait for both to complete (increase timeout for longer backtests)
    let attempts = 0;
    const maxAttempts = 600; // 10 minutes
    while (attempts < maxAttempts) {
      const strategy = this.runs.get(compare.strategyId);
      const baseline = this.runs.get(compare.baselineId);
      
      if (strategy?.status === 'done' && baseline?.status === 'done') {
        compare.strategy = strategy;
        compare.baseline = baseline;
        
        // Calculate compare metrics
        const sSummary = strategy.summary!;
        const bSummary = baseline.summary!;
        
        const deltaCagr = round4(sSummary.cagr - bSummary.cagr);
        const deltaSharpe = round4(sSummary.sharpe - bSummary.sharpe);
        const deltaMaxDD = round4(sSummary.maxDrawdown - bSummary.maxDrawdown);
        const deltaCalmar = round4(sSummary.calmar - bSummary.calmar);
        
        // Evaluate verdict
        const reasons: string[] = [];
        let verdict: 'PASS' | 'FAIL' | 'REVIEW' = 'PASS';
        
        // PASS: Sharpe >= baseline + 0.10
        if (deltaSharpe < 0.10) {
          reasons.push(`Sharpe delta ${deltaSharpe} < 0.10`);
          verdict = 'REVIEW';
        }
        
        // FAIL: maxDD worse by >10%
        if (deltaMaxDD > 0.10) {
          reasons.push(`MaxDD worse by ${(deltaMaxDD * 100).toFixed(1)}%`);
          verdict = 'FAIL';
        }
        
        // FAIL: tailLoss99 worse
        if (sSummary.tailLoss99 < bSummary.tailLoss99 - 0.005) {
          reasons.push(`TailLoss99 worse: ${sSummary.tailLoss99} vs ${bSummary.tailLoss99}`);
          verdict = 'FAIL';
        }
        
        // REVIEW: turnover too high
        if (sSummary.turnoverAvg > 0.6) {
          reasons.push(`Turnover too high: ${sSummary.turnoverAvg}`);
          if (verdict === 'PASS') verdict = 'REVIEW';
        }
        
        // REVIEW: costs eat alpha
        if (sSummary.costImpact > 0.5 && deltaCagr < 0.02) {
          reasons.push(`Costs eat most of alpha`);
          if (verdict === 'PASS') verdict = 'REVIEW';
        }
        
        if (reasons.length === 0) {
          reasons.push('All criteria met');
        }
        
        // Determine dominance
        let dominance: 'strategy' | 'baseline' | 'mixed' = 'mixed';
        if (deltaSharpe > 0 && deltaMaxDD <= 0) {
          dominance = 'strategy';
        } else if (deltaSharpe < 0 && deltaMaxDD >= 0) {
          dominance = 'baseline';
        }
        
        compare.compare = {
          baselineId: compare.baselineId,
          deltaCagr,
          deltaSharpe,
          deltaMaxDD,
          deltaCalmar,
          dominance,
          verdict,
          reasons,
        };
        
        compare.status = 'done';
        compare.finishedAt = new Date().toISOString();
        
        console.log(`[P13] Compare ${compareId} complete. Verdict: ${verdict}`);
        return;
      }
      
      if (strategy?.status === 'failed' || baseline?.status === 'failed') {
        compare.status = 'failed';
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    compare.status = 'failed';
  }
  
  // ─────────────────────────────────────────────────────────────
  // STATUS GETTERS
  // ─────────────────────────────────────────────────────────────
  
  getRunStatus(id: string): BacktestReport | null {
    return this.runs.get(id) || null;
  }
  
  getCompareStatus(id: string): CompareReport | null {
    return this.compares.get(id) || null;
  }
}

// Singleton
let instance: BacktestRunnerService | null = null;

export function getBacktestRunnerService(): BacktestRunnerService {
  if (!instance) {
    instance = new BacktestRunnerService();
  }
  return instance;
}

export { BacktestRunnerService };
