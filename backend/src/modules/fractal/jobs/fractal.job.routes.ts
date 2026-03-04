/**
 * BLOCK 56.6 — Fractal Daily Job Routes
 * 
 * Admin endpoints for manual job control:
 * - POST /api/fractal/v2.1/admin/jobs/daily-run - Run daily job manually
 * - GET /api/fractal/v2.1/admin/jobs/status - Get last run status
 * - GET /api/fractal/v2.1/admin/jobs/history - Get job history
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { fractalDailyJobService } from './fractal.daily.job.js';
import { integrityGuardService } from '../services/integrity-guard.service.js';

export async function fractalJobRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/integrity
   * 
   * Check data integrity for SPX/DXY/BTC
   * Optionally auto-bootstrap if critical
   * 
   * Query:
   *   autoBootstrap?: boolean (default: false)
   */
  fastify.get('/api/fractal/v2.1/admin/integrity', async (
    request: FastifyRequest<{
      Querystring: { autoBootstrap?: string }
    }>
  ) => {
    const autoBootstrap = request.query.autoBootstrap === 'true';
    
    try {
      const result = await integrityGuardService.checkAll(autoBootstrap);
      return {
        ok: result.allOk,
        ...result
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message
      };
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/jobs/daily-run
   * 
   * Manually trigger the daily forward-truth cycle
   * 
   * Body:
   *   symbol?: string (default: BTC, only BTC allowed)
   */
  fastify.post('/api/fractal/v2.1/admin/jobs/daily-run', async (
    request: FastifyRequest<{
      Body: { symbol?: string }
    }>
  ) => {
    const symbol = request.body?.symbol ?? 'BTC';
    
    // BTC-only check at route level
    if (symbol !== 'BTC') {
      return {
        error: true,
        message: 'Fractal forward scheduler supports BTC only'
      };
    }
    
    // Check if already running
    if (fractalDailyJobService.isJobRunning()) {
      return {
        error: true,
        message: 'Daily job is already running',
        running: true
      };
    }
    
    try {
      const result = await fractalDailyJobService.runDaily(symbol);
      return result;
    } catch (err: any) {
      return {
        error: true,
        message: err.message
      };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/jobs/status
   * 
   * Get the status of the last daily job run
   */
  fastify.get('/api/fractal/v2.1/admin/jobs/status', async () => {
    const lastRun = fractalDailyJobService.getLastRun();
    const isRunning = fractalDailyJobService.isJobRunning();
    
    if (!lastRun) {
      return {
        hasRun: false,
        isRunning,
        message: 'No daily job has been run yet'
      };
    }
    
    return {
      hasRun: true,
      isRunning,
      lastRun: {
        runId: lastRun.runId,
        symbol: lastRun.symbol,
        startedAt: lastRun.startedAt.toISOString(),
        completedAt: lastRun.completedAt?.toISOString() ?? null,
        status: lastRun.status,
        stepsCount: lastRun.steps.length,
        error: lastRun.error
      }
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/jobs/history
   * 
   * Get job run history
   * 
   * Query:
   *   limit?: number (default: 10, max: 30)
   */
  fastify.get('/api/fractal/v2.1/admin/jobs/history', async (
    request: FastifyRequest<{
      Querystring: { limit?: string }
    }>
  ) => {
    const limit = Math.min(30, parseInt(request.query.limit ?? '10', 10));
    const history = fractalDailyJobService.getHistory(limit);
    
    return {
      count: history.length,
      runs: history.map(run => ({
        runId: run.runId,
        symbol: run.symbol,
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
        status: run.status,
        stepsCount: run.steps.length,
        steps: run.steps.map(s => ({
          name: s.name,
          status: s.status,
          durationMs: s.completedAt && s.startedAt 
            ? s.completedAt.getTime() - s.startedAt.getTime() 
            : null
        }))
      }))
    };
  });
}
