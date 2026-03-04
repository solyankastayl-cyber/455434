/**
 * P13: Portfolio Backtest Routes
 * 
 * POST /api/backtest/run-async - Start single backtest
 * POST /api/backtest/compare-async - Start compare (strategy vs baseline)
 * GET /api/backtest/status?id=xxx - Get run/compare status
 * GET /api/backtest/report?id=xxx - Get full report
 */

import { FastifyInstance } from 'fastify';
import { getBacktestRunnerService } from './services/backtest_runner.service.js';
import type { BacktestRunRequest, CompareRequest } from './contracts/backtest.contract.js';

export async function p13BacktestRoutes(fastify: FastifyInstance): Promise<void> {
  const service = getBacktestRunnerService();
  
  /**
   * POST /api/backtest/run-async
   * Start single backtest
   */
  fastify.post('/api/backtest/run-async', async (request) => {
    const config = request.body as BacktestRunRequest;
    
    if (!config.start || !config.end) {
      return { ok: false, error: 'Missing start or end date' };
    }
    
    const result = await service.runAsync(config);
    
    return {
      ok: true,
      id: result.id,
      status: result.status,
      message: 'Backtest started. Poll /api/backtest/status?id=... for results.',
    };
  });
  
  /**
   * POST /api/backtest/compare-async
   * Start compare (strategy vs baseline)
   */
  fastify.post('/api/backtest/compare-async', async (request) => {
    const body = request.body as CompareRequest;
    
    if (!body.strategy || !body.baseline) {
      return { ok: false, error: 'Missing strategy or baseline config' };
    }
    
    const result = await service.compareAsync(body);
    
    return {
      ok: true,
      strategyId: result.strategyId,
      baselineId: result.baselineId,
      compareId: result.compareId,
      message: 'P13 compare started. Poll /api/backtest/status?id=<compareId> for results.',
    };
  });
  
  /**
   * GET /api/backtest/status
   * Get backtest or compare status
   */
  fastify.get('/api/backtest/status', async (request) => {
    const { id } = request.query as { id?: string };
    
    if (!id) {
      return { ok: false, error: 'Missing id parameter' };
    }
    
    // Try run first
    const run = service.getRunStatus(id);
    if (run) {
      return {
        ok: true,
        type: 'run',
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        summary: run.summary,
        error: run.error,
      };
    }
    
    // Try compare
    const compare = service.getCompareStatus(id);
    if (compare) {
      return {
        ok: true,
        type: 'compare',
        id: compare.id,
        status: compare.status,
        strategyId: compare.strategyId,
        baselineId: compare.baselineId,
        startedAt: compare.startedAt,
        finishedAt: compare.finishedAt,
        compare: compare.compare,
      };
    }
    
    return { ok: false, error: 'Run not found' };
  });
  
  /**
   * GET /api/backtest/report
   * Get full report with series (optional compact mode)
   */
  fastify.get('/api/backtest/report', async (request) => {
    const { id, compact } = request.query as { id?: string; compact?: string };
    
    if (!id) {
      return { ok: false, error: 'Missing id parameter' };
    }
    
    // Try run
    const run = service.getRunStatus(id);
    if (run) {
      if (compact === '1' && run.series) {
        // Return without full series
        return {
          ok: true,
          type: 'run',
          ...run,
          series: {
            dates: run.series.dates.slice(0, 5),
            nav: [run.series.nav[0], run.series.nav[run.series.nav.length - 1]],
            totalPeriods: run.series.dates.length,
          },
        };
      }
      return { ok: true, type: 'run', ...run };
    }
    
    // Try compare
    const compare = service.getCompareStatus(id);
    if (compare) {
      if (compact === '1') {
        return {
          ok: true,
          type: 'compare',
          id: compare.id,
          status: compare.status,
          strategyId: compare.strategyId,
          baselineId: compare.baselineId,
          compare: compare.compare,
          strategySummary: compare.strategy?.summary,
          baselineSummary: compare.baseline?.summary,
        };
      }
      return { ok: true, type: 'compare', ...compare };
    }
    
    return { ok: false, error: 'Run not found' };
  });
  
  console.log('[P13] Portfolio backtest routes registered');
}
