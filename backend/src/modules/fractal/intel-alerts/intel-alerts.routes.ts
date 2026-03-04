/**
 * BLOCK 83 — Intel Alerts Routes
 * 
 * API:
 * - GET /api/fractal/v2.1/admin/intel/alerts
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { intelAlertsService } from './intel-alerts.service.js';

export async function registerIntelAlertsRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/fractal/v2.1/admin/intel';
  
  /**
   * GET /admin/intel/alerts
   * List recent intel alerts for admin UI
   */
  fastify.get(`${prefix}/alerts`, async (req: FastifyRequest<{
    Querystring: { symbol?: string; source?: string; limit?: string };
  }>) => {
    const items = await intelAlertsService.list({
      symbol: req.query.symbol,
      source: req.query.source,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    
    return { ok: true, items, count: items.length };
  });
  
  fastify.log.info('[Fractal] BLOCK 83: Intel Alerts routes registered');
}

export default registerIntelAlertsRoutes;
