/**
 * BLOCK 80.1 — Scheduler Routes
 * 
 * API endpoints for daily-run control.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { schedulerService } from './scheduler.service.js';

export async function schedulerRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/ops/daily-run/status
   * 
   * Get current scheduler status
   */
  fastify.get('/api/fractal/v2.1/admin/ops/daily-run/status', async () => {
    try {
      const status = await schedulerService.getStatus();
      return { ok: true, ...status };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/ops/daily-run/enable
   * 
   * Enable daily-run scheduler
   */
  fastify.post('/api/fractal/v2.1/admin/ops/daily-run/enable', async () => {
    try {
      const result = await schedulerService.enable();
      return { ok: true, ...result };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/ops/daily-run/disable
   * 
   * Disable daily-run scheduler
   */
  fastify.post('/api/fractal/v2.1/admin/ops/daily-run/disable', async () => {
    try {
      const result = await schedulerService.disable();
      return { ok: true, ...result };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/ops/daily-run/run-now
   * 
   * Trigger manual run
   */
  fastify.post('/api/fractal/v2.1/admin/ops/daily-run/run-now', async () => {
    try {
      const result = await schedulerService.runNow('MANUAL');
      return result;
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/ops/daily-run/history
   * 
   * Get job run history
   */
  fastify.get('/api/fractal/v2.1/admin/ops/daily-run/history', async (
    request: FastifyRequest<{ Querystring: { limit?: string } }>
  ) => {
    try {
      const limit = request.query.limit ? parseInt(request.query.limit) : 30;
      const history = await schedulerService.getHistory(limit);
      return { ok: true, history, total: history.length };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  fastify.log.info('[Fractal] BLOCK 80.1: Scheduler routes registered');
}

export default schedulerRoutes;
