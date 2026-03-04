/**
 * DXY FRACTAL OVERVIEW ROUTES
 */

import { FastifyInstance } from 'fastify';
import { getDxyOverviewPack } from './dxy_overview.service.js';

export async function dxyOverviewRoutes(fastify: FastifyInstance): Promise<void> {
  // Health check
  fastify.get('/api/ui/fractal/dxy/health', async () => {
    return { ok: true, module: 'ui-dxy' };
  });
  
  // Main aggregating endpoint
  fastify.get<{ Querystring: { h?: string } }>(
    '/api/ui/fractal/dxy/overview',
    async (req, reply) => {
      try {
        const horizon = parseInt(req.query.h || '90', 10);
        const validHorizons = [7, 14, 30, 90, 180, 365];
        const h = validHorizons.includes(horizon) ? horizon : 90;
        
        const pack = await getDxyOverviewPack(h);
        
        return { ok: true, ...pack };
      } catch (err) {
        reply.code(500);
        return { ok: false, error: (err as Error).message };
      }
    }
  );
  
  fastify.log.info('[UI DXY] Routes registered at /api/ui/fractal/dxy/*');
}

export default dxyOverviewRoutes;
