/**
 * Bridge Detection API Routes
 * 
 * Endpoints:
 * - GET /api/bridge/migrations - list detected migrations
 * - GET /api/bridge/migrations/:id - get migration details
 * - GET /api/bridge/stats - migration statistics
 * - POST /api/bridge/scan - trigger migration scan
 * - POST /api/bridge/seed - seed test data (dev)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  BridgeMigrationModel,
  getRecentMigrations,
  getMigrationById,
} from './bridge_migration.model.js';
import {
  scanForMigrations,
  matchEvents,
  getMigrationStats,
  seedTestMigrations,
} from './bridge_detection.service.js';

// Schemas
const GetMigrationsQuery = z.object({
  fromChain: z.string().optional(),
  toChain: z.string().optional(),
  wallet: z.string().optional(),
  minConfidence: z.coerce.number().optional(),
  limit: z.coerce.number().optional().default(50),
});

const MigrationIdParams = z.object({
  id: z.string().min(1),
});

const ScanBody = z.object({
  windowMinutes: z.number().optional().default(60),
});

const MatchEventsBody = z.object({
  eventIdA: z.string().min(1),
  eventIdB: z.string().min(1),
});

export async function bridgeDetectionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/bridge/migrations
   * List detected bridge migrations
   */
  app.get('/migrations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = GetMigrationsQuery.parse(request.query);
      
      const migrations = await getRecentMigrations(query.limit, {
        fromChain: query.fromChain,
        toChain: query.toChain,
        wallet: query.wallet,
        minConfidence: query.minConfidence,
      });
      
      return {
        ok: true,
        success: true,
        count: migrations.length,
        migrations: migrations.map(m => ({
          migrationId: m.migrationId,
          wallet: m.wallet,
          token: m.token,
          fromChain: m.fromChain,
          toChain: m.toChain,
          amountFrom: m.amountFrom,
          amountTo: m.amountTo,
          amountDeltaPct: m.amountDeltaPct,
          startedAt: m.startedAt,
          completedAt: m.completedAt,
          windowSeconds: m.windowSeconds,
          confidence: m.confidence,
          confidenceFactors: m.confidenceFactors,
          status: m.status,
          createdAt: m.createdAt,
        })),
      };
    } catch (err) {
      console.error('Failed to get migrations:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get migrations' });
    }
  });

  /**
   * GET /api/bridge/migrations/:id
   * Get migration details
   */
  app.get('/migrations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = MigrationIdParams.parse(request.params);
    
    try {
      const migration = await getMigrationById(params.id);
      
      if (!migration) {
        return reply.status(404).send({ ok: false, error: 'Migration not found' });
      }
      
      return {
        ok: true,
        success: true,
        migration: {
          migrationId: migration.migrationId,
          wallet: migration.wallet,
          actorId: migration.actorId,
          token: migration.token,
          tokenNormalized: migration.tokenNormalized,
          fromChain: migration.fromChain,
          toChain: migration.toChain,
          amountFrom: migration.amountFrom,
          amountTo: migration.amountTo,
          amountDeltaPct: migration.amountDeltaPct,
          startedAt: migration.startedAt,
          completedAt: migration.completedAt,
          windowSeconds: migration.windowSeconds,
          confidence: migration.confidence,
          confidenceFactors: migration.confidenceFactors,
          sourceEventIds: migration.sourceEventIds,
          sourceEventTypes: migration.sourceEventTypes,
          status: migration.status,
          createdAt: migration.createdAt,
        },
      };
    } catch (err) {
      console.error('Failed to get migration:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to get migration' });
    }
  });

  /**
   * GET /api/bridge/stats
   * Get migration statistics
   */
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await getMigrationStats();
      
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
   * POST /api/bridge/scan
   * Trigger migration detection scan
   */
  app.post('/scan', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ScanBody.parse(request.body || {});
      
      const result = await scanForMigrations(body.windowMinutes);
      
      return {
        ok: true,
        success: true,
        message: `Scanned ${result.scanned} events, detected ${result.detected} migrations`,
        ...result,
        migrations: result.migrations.map(m => ({
          migrationId: m.migrationId,
          fromChain: m.fromChain,
          toChain: m.toChain,
          confidence: m.confidence,
        })),
      };
    } catch (err) {
      console.error('Failed to scan:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to scan' });
    }
  });

  /**
   * POST /api/bridge/match
   * Check if two events match bridge criteria
   */
  app.post('/match', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = MatchEventsBody.parse(request.body);
      
      const result = await matchEvents(body.eventIdA, body.eventIdB);
      
      return {
        ok: true,
        success: true,
        ...result,
      };
    } catch (err) {
      console.error('Failed to match events:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to match events' });
    }
  });

  /**
   * POST /api/bridge/seed
   * Seed test migrations (development only)
   */
  app.post('/seed', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await seedTestMigrations();
      
      return {
        ok: true,
        success: true,
        message: `Seeded ${result.created} test migrations`,
        ...result,
      };
    } catch (err) {
      console.error('Failed to seed:', err);
      return reply.status(500).send({ ok: false, error: 'Failed to seed' });
    }
  });

  app.log.info('Bridge Detection routes registered');
}
