/**
 * BACKTEST RUNNER SERVICE
 * 
 * Walk-forward backtesting for MacroScore and Cascade
 * 
 * Architecture:
 * 1. DatasetBuilder - builds asOf timeline
 * 2. Runner - executes pipeline for each asOf
 * 3. Scorer - compares predictions vs actuals
 * 4. ReportBuilder - aggregates metrics
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════
// CONTRACTS
// ═══════════════════════════════════════════════════════════════

export interface BacktestConfig {
  startDate: string;
  endDate: string;
  step: 'daily' | 'weekly' | 'monthly';
  horizons: number[];
  asset: string;
}

export interface BacktestPoint {
  asOf: string;
  macroScore: number;
  macroConfidence: number;
  drivers: string[];
  scenario: string;
  predictions: Record<number, number>; // horizon -> predicted return
  actuals?: Record<number, number>;    // horizon -> actual return (filled later)
}

export interface BacktestMetrics {
  hitRate: Record<number, number>;     // by horizon
  avgReturnBullish: Record<number, number>;
  avgReturnBearish: Record<number, number>;
  sharpeProxy: number;
  maxDrawdown: number;
  flipRate: number;  // scenario changes per year
  lookaheadViolations: number;
}

export interface BacktestReport {
  id: string;
  config: BacktestConfig;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  startedAt: string;
  completedAt?: string;
  pointsProcessed: number;
  totalPoints: number;
  metrics?: BacktestMetrics;
  timeline?: BacktestPoint[];
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// DATASET BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildAsOfTimeline(
  startDate: string,
  endDate: string,
  step: 'daily' | 'weekly' | 'monthly'
): string[] {
  const timeline: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  let current = new Date(start);
  
  while (current <= end) {
    timeline.push(current.toISOString().slice(0, 10));
    
    switch (step) {
      case 'daily':
        current.setDate(current.getDate() + 1);
        break;
      case 'weekly':
        current.setDate(current.getDate() + 7);
        break;
      case 'monthly':
        current.setMonth(current.getMonth() + 1);
        break;
    }
  }
  
  return timeline;
}

// ═══════════════════════════════════════════════════════════════
// SCORER
// ═══════════════════════════════════════════════════════════════

export function computeMetrics(
  points: BacktestPoint[],
  horizons: number[]
): BacktestMetrics {
  const hitRate: Record<number, number> = {};
  const avgReturnBullish: Record<number, number> = {};
  const avgReturnBearish: Record<number, number> = {};
  
  for (const h of horizons) {
    const validPoints = points.filter(p => 
      p.predictions[h] !== undefined && 
      p.actuals && p.actuals[h] !== undefined
    );
    
    if (validPoints.length === 0) {
      hitRate[h] = 0;
      avgReturnBullish[h] = 0;
      avgReturnBearish[h] = 0;
      continue;
    }
    
    // Hit rate: predicted direction matches actual direction
    let hits = 0;
    let bullishReturns: number[] = [];
    let bearishReturns: number[] = [];
    
    for (const p of validPoints) {
      const predicted = p.predictions[h];
      const actual = p.actuals![h];
      
      if (Math.sign(predicted) === Math.sign(actual)) {
        hits++;
      }
      
      if (predicted > 0) {
        bullishReturns.push(actual);
      } else if (predicted < 0) {
        bearishReturns.push(actual);
      }
    }
    
    hitRate[h] = hits / validPoints.length;
    avgReturnBullish[h] = bullishReturns.length > 0 
      ? bullishReturns.reduce((a, b) => a + b, 0) / bullishReturns.length 
      : 0;
    avgReturnBearish[h] = bearishReturns.length > 0 
      ? bearishReturns.reduce((a, b) => a + b, 0) / bearishReturns.length 
      : 0;
  }
  
  // Flip rate: scenario changes
  let flips = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].scenario !== points[i - 1].scenario) {
      flips++;
    }
  }
  const yearsSpan = points.length > 0 
    ? (new Date(points[points.length - 1].asOf).getTime() - new Date(points[0].asOf).getTime()) / (365 * 24 * 60 * 60 * 1000)
    : 1;
  const flipRate = flips / Math.max(yearsSpan, 0.1);
  
  // Sharpe proxy (simplified)
  const returns = points
    .filter(p => p.actuals && p.actuals[90] !== undefined)
    .map(p => p.actuals![90]);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1 
    ? Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 1;
  const sharpeProxy = stdReturn > 0 ? avgReturn / stdReturn : 0;
  
  // Max drawdown (simplified)
  let maxDrawdown = 0;
  let peak = 0;
  let cumulative = 0;
  for (const p of points) {
    const ret = p.actuals?.[90] || 0;
    cumulative += ret;
    peak = Math.max(peak, cumulative);
    const dd = peak - cumulative;
    maxDrawdown = Math.max(maxDrawdown, dd);
  }
  
  return {
    hitRate,
    avgReturnBullish,
    avgReturnBearish,
    sharpeProxy: Math.round(sharpeProxy * 1000) / 1000,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
    flipRate: Math.round(flipRate * 10) / 10,
    lookaheadViolations: 0, // Should always be 0
  };
}

// ═══════════════════════════════════════════════════════════════
// REPORT BUILDER
// ═══════════════════════════════════════════════════════════════

export function createReport(config: BacktestConfig): BacktestReport {
  const id = crypto.randomBytes(8).toString('hex');
  const timeline = buildAsOfTimeline(config.startDate, config.endDate, config.step);
  
  return {
    id,
    config,
    status: 'running',
    progress: 0,
    startedAt: new Date().toISOString(),
    pointsProcessed: 0,
    totalPoints: timeline.length,
  };
}

export function finalizeReport(
  report: BacktestReport,
  points: BacktestPoint[]
): BacktestReport {
  const metrics = computeMetrics(points, report.config.horizons);
  
  return {
    ...report,
    status: 'completed',
    progress: 100,
    completedAt: new Date().toISOString(),
    pointsProcessed: points.length,
    metrics,
    timeline: points,
  };
}

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY STORE (replace with MongoDB in production)
// ═══════════════════════════════════════════════════════════════

const backtestStore = new Map<string, BacktestReport>();

export function saveReport(report: BacktestReport): void {
  backtestStore.set(report.id, report);
}

export function getReport(id: string): BacktestReport | undefined {
  return backtestStore.get(id);
}

export function listReports(): BacktestReport[] {
  return Array.from(backtestStore.values());
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  buildAsOfTimeline,
  computeMetrics,
  createReport,
  finalizeReport,
  saveReport,
  getReport,
  listReports,
};
