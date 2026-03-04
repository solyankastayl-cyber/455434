/**
 * Timelines Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './timelines.service.js';
import { GetTimelineParams, GetTimelineQuery, GetTimelineByTypeQuery } from './timelines.schema.js';

export async function timelinesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/timeline/strategy/:address
   * Get strategy timeline for address
   */
  app.get('/strategy/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetTimelineParams.parse(request.params);
    const query = GetTimelineQuery.parse(request.query);
    
    const events = await service.getStrategyTimeline(params.address, query.limit);
    
    return { ok: true, data: events, count: events.length };
  });
  
  /**
   * GET /api/timeline/signals/:address
   * Get signal timeline for address
   */
  app.get('/signals/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetTimelineParams.parse(request.params);
    const query = GetTimelineQuery.parse(request.query);
    
    const events = await service.getSignalTimeline(params.address, query.limit);
    
    return { ok: true, data: events, count: events.length };
  });
  
  /**
   * GET /api/timeline/bundles/:address
   * Get bundle timeline for address
   */
  app.get('/bundles/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetTimelineParams.parse(request.params);
    const query = GetTimelineQuery.parse(request.query);
    
    const events = await service.getBundleTimeline(params.address, query.limit);
    
    return { ok: true, data: events, count: events.length };
  });
  
  /**
   * GET /api/timeline/unified/:address
   * Get unified timeline (all events merged)
   */
  app.get('/unified/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetTimelineParams.parse(request.params);
    const query = GetTimelineQuery.parse(request.query);
    
    const events = await service.getUnifiedTimeline(params.address, query.limit);
    
    return { ok: true, data: events, count: events.length };
  });
}
