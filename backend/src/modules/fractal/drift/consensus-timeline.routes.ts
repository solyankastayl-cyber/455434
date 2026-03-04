/**
 * BLOCK 80.3 — Consensus Timeline Routes
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { consensusTimelineService } from './consensus-timeline.service.js';

export async function consensusTimelineRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/consensus/timeline
   * 
   * Get consensus timeline data
   */
  fastify.get('/api/fractal/v2.1/admin/consensus/timeline', async (
    request: FastifyRequest<{ Querystring: { symbol?: string; days?: string } }>
  ) => {
    const symbol = request.query.symbol || 'BTC';
    const days = request.query.days ? parseInt(request.query.days) : 30;
    
    try {
      const result = await consensusTimelineService.getTimeline(symbol, days);
      return { ok: true, ...result };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/consensus/snapshot
   * 
   * Manually trigger snapshot write
   */
  fastify.post('/api/fractal/v2.1/admin/consensus/snapshot', async (
    request: FastifyRequest<{ Querystring: { symbol?: string } }>
  ) => {
    const symbol = request.query.symbol || 'BTC';
    
    try {
      const result = await consensusTimelineService.buildAndWriteSnapshot(symbol);
      return { ok: true, ...result };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  fastify.log.info('[Fractal] BLOCK 80.3: Consensus Timeline routes registered');
}

export default consensusTimelineRoutes;
