/**
 * BLOCK 85 — Model Health Routes
 * 
 * API:
 * - GET /api/fractal/v2.1/admin/model-health
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { modelHealthService } from './model-health.service.js';

export async function registerModelHealthRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/fractal/v2.1/admin';
  
  /**
   * GET /admin/model-health
   * Get current composite model health score
   */
  fastify.get(`${prefix}/model-health`, async (req: FastifyRequest<{
    Querystring: { symbol?: string };
  }>) => {
    const symbol = req.query.symbol || 'BTC';
    
    try {
      const health = await modelHealthService.getCurrent(symbol);
      return { ok: true, ...health };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
  
  fastify.log.info('[Fractal] BLOCK 85: Model Health routes registered');
}

export default registerModelHealthRoutes;
