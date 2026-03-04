/**
 * BLOCK 65 — Volatility Attribution Routes
 * 
 * GET /api/fractal/v2.1/admin/volatility/attribution
 * GET /api/fractal/v2.1/admin/volatility/timeline
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getVolatilityAttributionService } from '../volatility/volatility.attribution.service.js';

export async function registerVolatilityRoutes(fastify: FastifyInstance) {
  const attributionService = getVolatilityAttributionService();

  // ═══════════════════════════════════════════════════════════════
  // Attribution endpoint
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/api/fractal/v2.1/admin/volatility/attribution', async (req: FastifyRequest) => {
    const query = req.query as { symbol?: string };
    const symbol = (query.symbol ?? 'BTC').toUpperCase();
    
    try {
      const result = await attributionService.buildAttribution(symbol);
      return result;
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[Volatility Attribution] Error');
      return {
        error: 'ATTRIBUTION_ERROR',
        message: err.message,
      };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Timeline endpoint
  // ═══════════════════════════════════════════════════════════════

  fastify.get('/api/fractal/v2.1/admin/volatility/timeline', async (req: FastifyRequest) => {
    const query = req.query as { symbol?: string; limit?: string };
    const symbol = (query.symbol ?? 'BTC').toUpperCase();
    const limit = parseInt(query.limit ?? '365', 10);
    
    try {
      const result = await attributionService.buildTimeline(symbol, limit);
      return result;
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[Volatility Timeline] Error');
      return {
        error: 'TIMELINE_ERROR',
        message: err.message,
      };
    }
  });

  fastify.log.info('[Fractal] P1.5: Volatility attribution routes registered');
}
