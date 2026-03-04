/**
 * Watchlist Routes V2
 * 
 * Endpoints:
 * - GET /api/watchlist - list items with event counts
 * - POST /api/watchlist - add item
 * - DELETE /api/watchlist/:id - remove item
 * - GET /api/watchlist/summary - summary stats
 * - GET /api/watchlist/events - list events
 * - POST /api/watchlist/seed - seed test data (dev only)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  WatchlistItemModel,
  findOrCreateWatchlistItem,
  removeWatchlistItem,
  getWatchlistItem,
} from './watchlist.model.js';
import {
  getWatchlistSummary,
  getWatchlistWithEventCounts,
  getEventsWithItems,
  seedWatchlistTestData,
} from './watchlist.service.js';
import {
  acknowledgeEvent,
} from './watchlist_event.model.js';
import {
  resolveAlertOnEventAck,
  syncWatchlistAlerts,
} from './watchlist_alerts.service.js';
import {
  getWatchlistActors,
  getActorProfile,
  getSuggestedActors,
} from './watchlist_actors.service.js';
import {
  getEventChanges,
  getRealtimeSummary,
  markEventsViewed,
  getNewEventsCount,
} from './watchlist_realtime.service.js';

// Helper to get userId
function getUserId(request: FastifyRequest): string {
  const userId = request.headers['x-user-id'] as string;
  return userId || 'anonymous';
}

// Schemas
const AddToWatchlistBody = z.object({
  type: z.enum(['token', 'wallet', 'actor', 'entity']),
  target: z.object({
    address: z.string().min(1),
    chain: z.string().default('ETH'),
    symbol: z.string().optional(),
    name: z.string().optional(),
  }),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const GetWatchlistQuery = z.object({
  type: z.enum(['token', 'wallet', 'actor', 'entity']).optional(),
});

const GetEventsQuery = z.object({
  chain: z.string().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  eventType: z.string().optional(),
  window: z.enum(['24h', '7d', '30d']).optional().default('7d'),
  limit: z.coerce.number().optional().default(50),
});

const WatchlistIdParams = z.object({
  id: z.string().min(1),
});

export async function watchlistRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/watchlist/summary
   * Get watchlist summary stats
   */
  app.get('/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    
    try {
      const summary = await getWatchlistSummary(userId === 'anonymous' ? undefined : userId);
      
      return {
        ok: true,
        success: true,
        ...summary,
      };
    } catch (err) {
      console.error('Failed to get watchlist summary:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get summary' });
    }
  });

  // =========================================================================
  // P1.1 - WATCHLIST ACTORS API
  // =========================================================================

  /**
   * GET /api/watchlist/actors
   * Get aggregated watchlist actors with intelligence data
   */
  app.get('/actors', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    
    try {
      const result = await getWatchlistActors(userId === 'anonymous' ? undefined : userId);
      
      return {
        ok: true,
        success: true,
        total: result.total,
        actors: result.actors.map(a => ({
          watchlistId: a.watchlistId,
          actorId: a.actorId,
          address: a.address,
          label: a.label,
          confidence: a.confidence,
          confidenceLevel: a.confidenceLevel,
          patterns: a.patterns,
          chains: a.chains,
          bridgeCount7d: a.bridgeCount7d,
          bridgeCount30d: a.bridgeCount30d,
          totalVolumeUsd: a.totalVolumeUsd,
          openAlerts: a.openAlerts,
          lastActivityAt: a.lastActivityAt,
          addedAt: a.addedAt,
        })),
      };
    } catch (err) {
      console.error('Failed to get watchlist actors:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get actors' });
    }
  });

  /**
   * GET /api/watchlist/actors/suggested
   * Get suggested actors to watch (high activity, not in watchlist)
   */
  app.get('/actors/suggested', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = z.object({
        limit: z.coerce.number().optional().default(5),
      }).parse(request.query);
      
      const suggested = await getSuggestedActors(query.limit);
      
      return {
        ok: true,
        success: true,
        count: suggested.length,
        actors: suggested,
      };
    } catch (err) {
      console.error('Failed to get suggested actors:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get suggestions' });
    }
  });

  /**
   * GET /api/watchlist/actors/:id/profile
   * Get detailed actor profile with events and alerts
   */
  app.get('/actors/:id/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({
      id: z.string().min(1),
    }).parse(request.params);
    
    try {
      const profile = await getActorProfile(params.id);
      
      if (!profile) {
        return reply.status(404).send({ 
          ok: false, 
          error: 'Actor not found',
          message: 'No actor profile found for this ID or address',
        });
      }
      
      return {
        ok: true,
        success: true,
        ...profile,
      };
    } catch (err) {
      console.error('Failed to get actor profile:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get profile' });
    }
  });

  // =========================================================================
  // P2.1 - REALTIME MONITORING API
  // =========================================================================

  /**
   * GET /api/watchlist/events/changes
   * Get event changes since timestamp (delta endpoint)
   */
  app.get('/events/changes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = z.object({
        since: z.string().optional(),
        limit: z.coerce.number().optional().default(50),
      }).parse(request.query);
      
      // Default to 5 minutes ago if no since provided
      const since = query.since 
        ? new Date(query.since) 
        : new Date(Date.now() - 5 * 60 * 1000);
      
      const delta = await getEventChanges(since, query.limit);
      
      return {
        ok: true,
        success: true,
        ...delta,
      };
    } catch (err) {
      console.error('Failed to get event changes:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get changes' });
    }
  });

  /**
   * GET /api/watchlist/summary/realtime
   * Get lightweight realtime summary for polling
   */
  app.get('/summary/realtime', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = z.object({
        window: z.coerce.number().optional().default(5), // minutes
      }).parse(request.query);
      
      const summary = await getRealtimeSummary(query.window);
      
      return {
        ok: true,
        success: true,
        ...summary,
      };
    } catch (err) {
      console.error('Failed to get realtime summary:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get summary' });
    }
  });

  /**
   * POST /api/watchlist/events/viewed
   * Mark events as viewed (batch)
   */
  app.post('/events/viewed', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = z.object({
        eventIds: z.array(z.string()).min(1).max(100),
      }).parse(request.body);
      
      const count = await markEventsViewed(body.eventIds);
      
      return {
        ok: true,
        success: true,
        marked: count,
      };
    } catch (err) {
      console.error('Failed to mark events viewed:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to mark viewed' });
    }
  });

  /**
   * GET /api/watchlist/events/count
   * Get new events count for badge
   */
  app.get('/events/count', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = z.object({
        since: z.string().optional(),
      }).parse(request.query);
      
      const since = query.since ? new Date(query.since) : undefined;
      const counts = await getNewEventsCount(since);
      
      return {
        ok: true,
        success: true,
        ...counts,
      };
    } catch (err) {
      console.error('Failed to get events count:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get count' });
    }
  });

  /**
   * GET /api/watchlist/events
   * Get watchlist events with item details
   */
  app.get('/events', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = GetEventsQuery.parse(request.query);
      
      const events = await getEventsWithItems({
        chain: query.chain,
        severity: query.severity,
        eventType: query.eventType,
        window: query.window as '24h' | '7d' | '30d',
        limit: query.limit,
      });
      
      return {
        ok: true,
        success: true,
        count: events.length,
        events: events.map(e => ({
          _id: e._id,
          eventType: e.eventType,
          severity: e.severity,
          chain: e.chain,
          chainFrom: e.chainFrom,
          chainTo: e.chainTo,
          title: e.title,
          description: e.description,
          metadata: e.metadata,
          acknowledged: e.acknowledged,
          timestamp: e.timestamp,
          item: e.item ? {
            _id: e.item._id,
            type: e.item.type,
            target: e.item.target,
          } : undefined,
        })),
      };
    } catch (err) {
      console.error('Failed to get watchlist events:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get events' });
    }
  });

  /**
   * POST /api/watchlist/events/:id/ack
   * Acknowledge an event and resolve corresponding alert
   */
  app.post('/events/:id/ack', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = WatchlistIdParams.parse(request.params);
    
    try {
      const success = await acknowledgeEvent(params.id);
      
      if (!success) {
        return reply.status(404).send({ ok: false, error: 'Event not found' });
      }
      
      // Also resolve corresponding system alert
      await resolveAlertOnEventAck(params.id);
      
      return { ok: true, success: true };
    } catch (err) {
      console.error('Failed to acknowledge event:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to acknowledge' });
    }
  });

  /**
   * POST /api/watchlist/sync-alerts
   * Sync watchlist events with system alerts
   */
  app.post('/sync-alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await syncWatchlistAlerts();
      
      return {
        ok: true,
        success: true,
        message: `Synced ${result.created} new alerts, ${result.existing} existing`,
        ...result,
      };
    } catch (err) {
      console.error('Failed to sync alerts:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to sync alerts' });
    }
  });

  /**
   * POST /api/watchlist/seed
   * Seed test data (dev only)
   */
  app.post('/seed', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    
    try {
      const result = await seedWatchlistTestData(userId);
      
      return {
        ok: true,
        success: true,
        message: `Seeded ${result.items} items and ${result.events} events`,
        ...result,
      };
    } catch (err) {
      console.error('Failed to seed watchlist:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to seed data' });
    }
  });

  /**
   * GET /api/watchlist
   * Get user's watchlist items with event counts
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const query = GetWatchlistQuery.parse(request.query);
    
    try {
      const items = await getWatchlistWithEventCounts(
        userId === 'anonymous' ? undefined : userId,
        query.type
      );
      
      return {
        ok: true,
        data: items.map(item => ({
          _id: item._id,
          type: item.type,
          target: item.target,
          note: (item as any).note,
          tags: (item as any).tags,
          createdAt: item.createdAt,
          eventCount: item.eventCount,
          lastEventAt: item.lastEventAt,
          alertCount: item.eventCount, // backwards compatibility
        })),
        count: items.length,
      };
    } catch (err) {
      console.error('Failed to get watchlist:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get watchlist' });
    }
  });

  /**
   * POST /api/watchlist
   * Add item to watchlist
   */
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    
    try {
      const body = AddToWatchlistBody.parse(request.body);
      
      const item = await findOrCreateWatchlistItem(userId, body.type, body.target);
      
      // Update note and tags if provided
      if (body.note || body.tags) {
        item.note = body.note;
        item.tags = body.tags;
        await item.save();
      }
      
      return reply.status(201).send({
        ok: true,
        data: {
          _id: item._id,
          type: item.type,
          target: item.target,
          note: item.note,
          tags: item.tags,
          createdAt: item.createdAt,
        },
      });
    } catch (err: any) {
      // Handle duplicate key error
      if (err.code === 11000) {
        return reply.status(409).send({ 
          ok: false, 
          error: 'Item already exists in watchlist' 
        });
      }
      console.error('Failed to add to watchlist:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to add item' });
    }
  });

  /**
   * DELETE /api/watchlist/:id
   * Remove item from watchlist
   */
  app.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = WatchlistIdParams.parse(request.params);
    
    const deleted = await removeWatchlistItem(userId, params.id);
    
    if (!deleted) {
      return reply.status(404).send({ ok: false, error: 'Item not found' });
    }
    
    return { ok: true };
  });

  /**
   * GET /api/watchlist/:id
   * Get single watchlist item with event count
   */
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = WatchlistIdParams.parse(request.params);
    
    const item = await getWatchlistItem(params.id);
    
    if (!item) {
      return reply.status(404).send({ ok: false, error: 'Item not found' });
    }
    
    return {
      ok: true,
      data: {
        _id: item._id,
        type: item.type,
        target: item.target,
        note: item.note,
        tags: item.tags,
        createdAt: item.createdAt,
      },
    };
  });

  app.log.info('Watchlist V2 routes registered');
}
