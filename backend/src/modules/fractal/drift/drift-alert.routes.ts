/**
 * BLOCK 80.2 — Drift Alert Routes
 * 
 * API endpoints for drift alerts.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { driftAlertService } from './drift-alert.service.js';

export async function driftAlertRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/fractal/v2.1/admin/drift/check-alert
   * 
   * Manually trigger drift check and alert
   */
  fastify.post('/api/fractal/v2.1/admin/drift/check-alert', async (
    request: FastifyRequest<{ Querystring: { symbol?: string } }>
  ) => {
    const symbol = request.query.symbol || 'BTC';
    
    try {
      const result = await driftAlertService.checkAndAlert(symbol);
      return { ok: true, ...result };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/drift/alerts
   * 
   * Get drift alert history
   */
  fastify.get('/api/fractal/v2.1/admin/drift/alerts', async (
    request: FastifyRequest<{ Querystring: { symbol?: string; limit?: string } }>
  ) => {
    const symbol = request.query.symbol || 'BTC';
    const limit = request.query.limit ? parseInt(request.query.limit) : 50;
    
    try {
      const alerts = await driftAlertService.getHistory(symbol, limit);
      return { ok: true, alerts, total: alerts.length };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/drift/alerts/stats
   * 
   * Get drift alert statistics
   */
  fastify.get('/api/fractal/v2.1/admin/drift/alerts/stats', async (
    request: FastifyRequest<{ Querystring: { symbol?: string } }>
  ) => {
    const symbol = request.query.symbol || 'BTC';
    
    try {
      const stats = await driftAlertService.getStats(symbol);
      return { ok: true, ...stats };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  fastify.log.info('[Fractal] BLOCK 80.2: Drift Alert routes registered');
}

export default driftAlertRoutes;
