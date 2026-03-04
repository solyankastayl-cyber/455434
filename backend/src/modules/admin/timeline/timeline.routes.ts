/**
 * P5.2 Timeline Routes — Version Timeline API
 */

import { FastifyInstance } from 'fastify';
import { buildTimeline, getTimelineSummary } from './timeline.service.js';

export async function registerTimelineRoutes(fastify: FastifyInstance) {
  // GET /api/admin/timeline?scope=BTC&limit=50
  fastify.get('/api/admin/timeline', async (req) => {
    const query = req.query as { scope?: string; limit?: string };
    const scope = (query.scope || 'BTC') as 'BTC' | 'SPX' | 'DXY' | 'CROSS_ASSET';
    const limit = parseInt(query.limit || '50', 10);
    
    const items = await buildTimeline(scope, limit);
    
    return {
      ok: true,
      scope,
      count: items.length,
      items,
    };
  });
  
  // GET /api/admin/timeline/summary
  fastify.get('/api/admin/timeline/summary', async () => {
    const summary = await getTimelineSummary();
    
    return {
      ok: true,
      summary,
    };
  });
  
  console.log('[Timeline] Routes registered at /api/admin/timeline');
}

export default registerTimelineRoutes;
