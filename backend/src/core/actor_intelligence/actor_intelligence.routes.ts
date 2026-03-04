/**
 * Actor Intelligence API Routes
 * 
 * Endpoints:
 * - GET /api/actors - list actor profiles
 * - GET /api/actors/:id - get actor profile
 * - GET /api/actors/stats - actor statistics
 * - GET /api/actors/events - actor events
 * - POST /api/actors/scan - trigger actor analysis
 * - POST /api/actors/analyze - analyze specific actor
 * - POST /api/actors/seed - seed test data
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getActorProfiles,
  getActorProfileById,
  getActorProfileByAddress,
  ActorConfidenceLevel,
} from './actor_profile.model.js';
import {
  getActorEvents,
  acknowledgeActorEvent,
} from './actor_event.model.js';
import {
  analyzeActor,
  scanActors,
  getActorStats,
  seedTestActorData,
} from './actor_pattern_detection.service.js';
import {
  syncActorAlerts,
  getActorAlerts,
} from './actor_alerts.service.js';

// Schemas
const GetActorsQuery = z.object({
  confidenceLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'IGNORED']).optional(),
  minConfidence: z.coerce.number().optional(),
  chain: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
});

const ActorIdParams = z.object({
  id: z.string().min(1),
});

const GetEventsQuery = z.object({
  actorId: z.string().optional(),
  type: z.string().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  limit: z.coerce.number().optional().default(50),
});

const AnalyzeBody = z.object({
  address: z.string().min(1),
  emitEvents: z.boolean().optional().default(true),
});

const ScanBody = z.object({
  windowDays: z.number().optional().default(7),
  limit: z.number().optional().default(100),
});

export async function actorIntelligenceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/actors
   * List actor profiles
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = GetActorsQuery.parse(request.query);
      
      const profiles = await getActorProfiles({
        confidenceLevel: query.confidenceLevel as ActorConfidenceLevel,
        minConfidence: query.minConfidence,
        chain: query.chain,
        limit: query.limit,
      });
      
      return {
        ok: true,
        success: true,
        count: profiles.length,
        actors: profiles.map(p => ({
          actorId: p.actorId,
          address: p.primaryAddress,
          chainsUsed: p.chainsUsed,
          chainCount: p.chainCount,
          bridgeCount7d: p.bridgeCount7d,
          bridgeCount30d: p.bridgeCount30d,
          totalMigrations: p.totalMigrations,
          avgMigrationSizeUsd: p.avgMigrationSizeUsd,
          totalVolumeUsd: p.totalVolumeUsd,
          dominantRoutes: p.dominantRoutes.slice(0, 3),
          activityPattern: p.activityPattern,
          confidenceScore: p.confidenceScore,
          confidenceLevel: p.confidenceLevel,
          patternScores: p.patternScores,
          lastActivityAt: p.lastActivityAt,
        })),
      };
    } catch (err) {
      console.error('Failed to get actors:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get actors' });
    }
  });

  /**
   * GET /api/actors/stats
   * Get actor statistics
   */
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await getActorStats();
      
      return {
        ok: true,
        success: true,
        ...stats,
      };
    } catch (err) {
      console.error('Failed to get stats:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get stats' });
    }
  });

  /**
   * GET /api/actors/events
   * Get actor events
   */
  app.get('/events', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = GetEventsQuery.parse(request.query);
      
      const events = await getActorEvents({
        actorId: query.actorId,
        type: query.type as any,
        severity: query.severity,
        limit: query.limit,
      });
      
      return {
        ok: true,
        success: true,
        count: events.length,
        events: events.map(e => ({
          eventId: e.eventId,
          actorId: e.actorId,
          actorAddress: e.actorAddress,
          type: e.type,
          severity: e.severity,
          title: e.title,
          description: e.description,
          explanation: e.explanation,
          confidence: e.confidence,
          relatedChains: e.relatedChains,
          acknowledged: e.acknowledged,
          timestamp: e.timestamp,
        })),
      };
    } catch (err) {
      console.error('Failed to get events:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get events' });
    }
  });

  /**
   * POST /api/actors/events/:id/ack
   * Acknowledge actor event
   */
  app.post('/events/:id/ack', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ActorIdParams.parse(request.params);
    
    try {
      const success = await acknowledgeActorEvent(params.id);
      
      if (!success) {
        return reply.status(404).send({ ok: false, error: 'Event not found' });
      }
      
      return { ok: true, success: true };
    } catch (err) {
      console.error('Failed to acknowledge event:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to acknowledge' });
    }
  });

  /**
   * GET /api/actors/:id
   * Get actor profile by ID or address
   */
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ActorIdParams.parse(request.params);
    
    try {
      // Try by actorId first, then by address
      let profile = await getActorProfileById(params.id);
      
      if (!profile && params.id.startsWith('0x')) {
        profile = await getActorProfileByAddress(params.id);
      }
      
      if (!profile) {
        return reply.status(404).send({ ok: false, error: 'Actor not found' });
      }
      
      // Get recent events for this actor
      const events = await getActorEvents({ actorId: profile.actorId, limit: 10 });
      
      return {
        ok: true,
        success: true,
        actor: {
          actorId: profile.actorId,
          address: profile.primaryAddress,
          chainsUsed: profile.chainsUsed,
          chainCount: profile.chainCount,
          bridgeCount7d: profile.bridgeCount7d,
          bridgeCount30d: profile.bridgeCount30d,
          totalMigrations: profile.totalMigrations,
          avgMigrationSizeUsd: profile.avgMigrationSizeUsd,
          maxMigrationSizeUsd: profile.maxMigrationSizeUsd,
          totalVolumeUsd: profile.totalVolumeUsd,
          dominantRoutes: profile.dominantRoutes,
          preferredFromChain: profile.preferredFromChain,
          preferredToChain: profile.preferredToChain,
          activityPattern: profile.activityPattern,
          avgTimeBetweenMigrations: profile.avgTimeBetweenMigrations,
          confidenceScore: profile.confidenceScore,
          confidenceLevel: profile.confidenceLevel,
          patternScores: profile.patternScores,
          firstSeenAt: profile.firstSeenAt,
          lastActivityAt: profile.lastActivityAt,
          lastUpdatedAt: profile.lastUpdatedAt,
        },
        recentEvents: events.map(e => ({
          eventId: e.eventId,
          type: e.type,
          severity: e.severity,
          title: e.title,
          confidence: e.confidence,
          timestamp: e.timestamp,
        })),
      };
    } catch (err) {
      console.error('Failed to get actor:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get actor' });
    }
  });

  /**
   * POST /api/actors/analyze
   * Analyze specific actor
   */
  app.post('/analyze', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = AnalyzeBody.parse(request.body);
      
      const result = await analyzeActor(body.address, body.emitEvents);
      
      return {
        ok: true,
        success: true,
        actorId: result.profile.actorId,
        confidenceScore: result.profile.confidenceScore,
        confidenceLevel: result.profile.confidenceLevel,
        patternScores: result.profile.patternScores,
        eventsCreated: result.events.length,
        events: result.events.map(e => ({
          type: e.type,
          severity: e.severity,
          confidence: e.confidence,
        })),
      };
    } catch (err) {
      console.error('Failed to analyze actor:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to analyze' });
    }
  });

  /**
   * POST /api/actors/scan
   * Scan all actors with recent bridge activity
   */
  app.post('/scan', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ScanBody.parse(request.body || {});
      
      const result = await scanActors(body.windowDays, body.limit);
      
      return {
        ok: true,
        success: true,
        message: `Scanned ${result.scanned} actors, ${result.updated} strategic, ${result.events} events`,
        ...result,
      };
    } catch (err) {
      console.error('Failed to scan actors:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to scan' });
    }
  });

  /**
   * POST /api/actors/seed
   * Seed test actor data
   */
  app.post('/seed', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await seedTestActorData();
      
      return {
        ok: true,
        success: true,
        message: `Seeded ${result.profiles} profiles, ${result.events} events`,
        ...result,
      };
    } catch (err) {
      console.error('Failed to seed:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to seed' });
    }
  });

  /**
   * POST /api/actors/sync-alerts
   * Sync actor events to system alerts
   */
  app.post('/sync-alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await syncActorAlerts(24);
      
      return {
        ok: true,
        success: true,
        message: `Synced ${result.synced} alerts, skipped ${result.skipped}`,
        ...result,
      };
    } catch (err) {
      console.error('Failed to sync alerts:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to sync alerts' });
    }
  });

  /**
   * GET /api/actors/alerts
   * Get actor-related system alerts
   */
  app.get('/alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = z.object({
        actorId: z.string().optional(),
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
        limit: z.coerce.number().optional().default(50),
      }).parse(request.query);
      
      const alerts = await getActorAlerts({
        actorId: query.actorId,
        severity: query.severity as any,
        limit: query.limit,
      });
      
      return {
        ok: true,
        success: true,
        count: alerts.length,
        alerts: alerts.map(a => ({
          alertId: a.alertId,
          type: a.type,
          category: a.category,
          severity: a.severity,
          title: a.title,
          message: a.message,
          status: a.status,
          metadata: a.metadata,
          createdAt: a.createdAt,
        })),
      };
    } catch (err) {
      console.error('Failed to get actor alerts:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get alerts' });
    }
  });

  app.log.info('Actor Intelligence routes registered');
}
