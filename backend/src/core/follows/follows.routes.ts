/**
 * Follows Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './follows.service.js';
import {
  CreateFollowBody,
  UpdateFollowBody,
  GetFollowsQuery,
  GetEventsQuery,
  FollowIdParams,
  EventIdParams,
} from './follows.schema.js';

// Helper to get userId (in production, from auth)
function getUserId(request: FastifyRequest): string {
  // For now, use header or default
  const userId = request.headers['x-user-id'] as string;
  return userId || 'anonymous';
}

export async function followsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/follow
   * Create a new follow
   */
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const body = CreateFollowBody.parse(request.body);
    
    try {
      const follow = await service.createFollow(
        userId,
        body.followType,
        body.targetId,
        body.settings,
        body.label,
        body.notes
      );
      
      return reply.status(201).send({ ok: true, data: follow });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Already following')) {
        return reply.status(409).send({ ok: false, error: 'Already following this target' });
      }
      throw err;
    }
  });
  
  /**
   * GET /api/follow/list
   * Get user's follows
   */
  app.get('/list', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const query = GetFollowsQuery.parse(request.query);
    
    const follows = await service.getUserFollows(userId, query.followType);
    
    return { ok: true, data: follows, count: follows.length };
  });
  
  /**
   * PUT /api/follow/:id
   * Update follow settings
   */
  app.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = FollowIdParams.parse(request.params);
    const body = UpdateFollowBody.parse(request.body);
    
    const follow = await service.updateFollow(params.id, userId, body);
    
    if (!follow) {
      return reply.status(404).send({ ok: false, error: 'Follow not found' });
    }
    
    return { ok: true, data: follow };
  });
  
  /**
   * DELETE /api/follow/:id
   * Delete follow
   */
  app.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = FollowIdParams.parse(request.params);
    
    const deleted = await service.deleteFollow(params.id, userId);
    
    if (!deleted) {
      return reply.status(404).send({ ok: false, error: 'Follow not found' });
    }
    
    return { ok: true };
  });
  
  /**
   * GET /api/follow/events
   * Get user's follow events (inbox)
   */
  app.get('/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const query = GetEventsQuery.parse(request.query);
    
    const events = await service.getUserEvents(userId, {
      unreadOnly: query.unread,
      limit: query.limit,
      offset: query.offset,
    });
    
    const unreadCount = await service.getUnreadCount(userId);
    
    return { ok: true, data: events, count: events.length, unreadCount };
  });
  
  /**
   * POST /api/follow/events/:id/read
   * Mark event as read
   */
  app.post('/events/:id/read', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = EventIdParams.parse(request.params);
    
    const event = await service.markEventAsRead(params.id, userId);
    
    if (!event) {
      return reply.status(404).send({ ok: false, error: 'Event not found' });
    }
    
    return { ok: true, data: event };
  });
  
  /**
   * POST /api/follow/events/read-all
   * Mark all events as read
   */
  app.post('/events/read-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    
    const count = await service.markAllEventsAsRead(userId);
    
    return { ok: true, markedCount: count };
  });
  
  /**
   * GET /api/follow/stats
   * Get follow and event stats
   */
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    
    const eventStats = await service.getEventStats(userId);
    
    return { ok: true, data: eventStats };
  });
}
