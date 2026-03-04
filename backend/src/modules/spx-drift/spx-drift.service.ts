/**
 * SPX DRIFT — Service
 * 
 * BLOCK B6.3 — Drift computation and history
 */

import type { 
  DriftIntelReport, 
  DriftWindow, 
  SpxCohort, 
  PerfMetrics, 
  DriftDelta 
} from './spx-drift.types.js';
import { buildNotes, computeConfidence, computeSeverityWithLive } from './spx-drift.severity.js';
import { SpxDriftHistoryModel } from './spx-drift.history.model.js';
import { SpxOutcomeModel } from '../spx-memory/spx-outcome.model.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function todayUTC(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function windowToDays(window: DriftWindow): number | 'all' {
  switch (window) {
    case '30d': return 30;
    case '60d': return 60;
    case '90d': return 90;
    case '180d': return 180;
    case '365d': return 365;
    case 'all': return 'all';
    default: return 90;
  }
}

function getDateRangeForCohort(cohort: SpxCohort): { start?: string; end?: string } {
  switch (cohort) {
    case 'LIVE': return { start: '2026-01-01' };
    case 'V2020': return { start: '2020-01-01', end: '2025-12-31' };
    case 'V1950': return { start: '1950-01-01', end: '1989-12-31' };
    case 'ALL_VINTAGE': return { start: '1950-01-01', end: '2025-12-31' };
    default: return { start: '2020-01-01', end: '2025-12-31' };
  }
}

// ═══════════════════════════════════════════════════════════════
// SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export class SpxDriftService {
  
  /**
   * Get performance metrics for a cohort
   */
  async getMetrics(args: {
    window: DriftWindow;
    cohort: SpxCohort;
    asOfDate?: string;
  }): Promise<PerfMetrics> {
    const asOfDate = args.asOfDate || todayUTC();
    const days = windowToDays(args.window);
    const cohortRange = getDateRangeForCohort(args.cohort);
    
    // Build query based on cohort date range
    const query: any = {
      symbol: 'SPX',
    };
    
    // Apply cohort date range filter on asOfDate
    if (cohortRange.start && cohortRange.end) {
      query.asOfDate = { $gte: cohortRange.start, $lte: cohortRange.end };
    } else if (cohortRange.start) {
      query.asOfDate = { $gte: cohortRange.start };
    }
    
    // If window is not 'all', further restrict by resolvedDate
    if (days !== 'all') {
      const cutoff = new Date(asOfDate);
      cutoff.setDate(cutoff.getDate() - (days as number));
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      // Use resolvedDate for window filtering
      query.resolvedDate = { $gte: cutoffStr, $lte: asOfDate };
    }
    
    const outcomes = await SpxOutcomeModel.find(query).lean();
    
    if (outcomes.length === 0) {
      return {
        samples: 0,
        hitRate: 0,
        expectancy: 0,
        sharpe: 0,
        maxDD: 0,
      };
    }
    
    const hits = outcomes.filter(o => o.hit).length;
    const returns = outcomes.map(o => o.actualReturnPct / 100);
    
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    
    // Expectancy
    const wins = returns.filter(r => r > 0);
    const losses = returns.filter(r => r < 0);
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
    const winRate = hits / outcomes.length;
    const expectancy = avgWin * winRate - avgLoss * (1 - winRate);
    
    // Max drawdown
    let peak = 1;
    let maxDD = 0;
    let equity = 1;
    for (const r of returns) {
      equity *= (1 + r);
      if (equity > peak) peak = equity;
      const dd = (equity - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
    
    return {
      samples: outcomes.length,
      hitRate: Math.round(winRate * 1000) / 10,
      expectancy: Math.round(expectancy * 10000) / 10000,
      sharpe: std > 0 ? Math.round((avgReturn / std) * 100) / 100 : 0,
      maxDD: Math.round(maxDD * 1000) / 10,
    };
  }
  
  /**
   * Build drift report
   */
  async buildReport(args: {
    window: DriftWindow;
    compare: Exclude<SpxCohort, 'LIVE'>;
    asOfDate?: string;
  }): Promise<DriftIntelReport> {
    const asOfDate = args.asOfDate || todayUTC();
    
    const [live, vintage] = await Promise.all([
      this.getMetrics({ window: args.window, cohort: 'LIVE', asOfDate }),
      this.getMetrics({ window: args.window, cohort: args.compare, asOfDate }),
    ]);
    
    const delta: DriftDelta = {
      hitRate: Math.round((live.hitRate - vintage.hitRate) * 100) / 100,
      expectancy: Math.round((live.expectancy - vintage.expectancy) * 10000) / 10000,
      sharpe: Math.round((live.sharpe - vintage.sharpe) * 100) / 100,
      maxDD: Math.round((live.maxDD - vintage.maxDD) * 100) / 100,
    };
    
    const confidence = computeConfidence(live.samples);
    const severity = computeSeverityWithLive(delta, live.samples);
    const notes = buildNotes(live, vintage, confidence, severity);
    
    return {
      symbol: 'SPX',
      window: args.window,
      compare: args.compare,
      asOfDate,
      live,
      vintage,
      delta,
      severity,
      confidence,
      notes,
    };
  }
  
  /**
   * Write daily history (for timeline)
   */
  async writeDailyHistory(args: {
    window: DriftWindow;
    compare: Exclude<SpxCohort, 'LIVE'>;
    date?: string;
  }) {
    const date = args.date || todayUTC();
    const report = await this.buildReport({
      window: args.window,
      compare: args.compare,
      asOfDate: date,
    });
    
    await SpxDriftHistoryModel.updateOne(
      { symbol: 'SPX', date, window: report.window, compare: report.compare },
      {
        $set: {
          symbol: 'SPX',
          date,
          window: report.window,
          compare: report.compare,
          live: report.live,
          vintage: report.vintage,
          delta: report.delta,
          severity: report.severity,
          confidence: report.confidence,
          notes: report.notes,
        },
      },
      { upsert: true }
    );
    
    return report;
  }
  
  /**
   * Get history for charts
   */
  async getHistory(args: {
    window: DriftWindow;
    compare: Exclude<SpxCohort, 'LIVE'>;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(args.limit || 60, 1), 365);
    
    return SpxDriftHistoryModel.find({
      symbol: 'SPX',
      window: args.window,
      compare: args.compare,
    })
      .sort({ date: -1 })
      .limit(limit)
      .lean();
  }
}

export const spxDriftService = new SpxDriftService();

export default SpxDriftService;
