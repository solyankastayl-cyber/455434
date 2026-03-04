/**
 * ETAP 6.2 — Aggregation Routes
 * 
 * API endpoints for aggregation management.
 * 
 * Endpoints:
 * - POST /api/aggregation/run - Run aggregation job
 * - GET /api/aggregation/stats - Get aggregation stats
 * - GET /api/aggregation/flows - Get actor flow aggregates
 * - GET /api/aggregation/activities - Get actor activity aggregates
 * - GET /api/aggregation/bridges - Get bridge aggregates
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  runAggregation,
  getActorFlows,
  getActorActivities,
  getBridges,
  getAggregationStats,
  AggWindow,
} from './aggregation.service.js';

// ==================== SCHEMAS ====================

const WindowQuerySchema = z.object({
  window: z.enum(['24h', '7d', '30d']).default('24h'),
  limit: z.coerce.number().min(1).max(500).default(100),
});

const RunAggregationSchema = z.object({
  window: z.enum(['24h', '7d', '30d']).default('24h'),
});

// ==================== ROUTES ====================

export async function registerAggregationRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/aggregation/run
   * Run aggregation job for a window
   */
  app.post('/api/aggregation/run', async (
    request: FastifyRequest<{ Body: z.infer<typeof RunAggregationSchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const body = RunAggregationSchema.parse(request.body || {});
      const result = await runAggregation(body.window as AggWindow);

      return reply.send({
        ok: true,
        data: result,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Aggregation Routes] Run failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/aggregation/stats
   * Get aggregation statistics
   */
  app.get('/api/aggregation/stats', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const stats = await getAggregationStats();

      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Aggregation Routes] Stats failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/aggregation/flows
   * Get actor flow aggregates
   */
  app.get('/api/aggregation/flows', async (
    request: FastifyRequest<{ Querystring: z.infer<typeof WindowQuerySchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const query = WindowQuerySchema.parse(request.query || {});
      const flows = await getActorFlows(query.window as AggWindow, query.limit);

      return reply.send({
        ok: true,
        data: {
          window: query.window,
          count: flows.length,
          flows,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Aggregation Routes] Flows failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/aggregation/activities
   * Get actor activity aggregates
   */
  app.get('/api/aggregation/activities', async (
    request: FastifyRequest<{ Querystring: z.infer<typeof WindowQuerySchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const query = WindowQuerySchema.parse(request.query || {});
      const activities = await getActorActivities(query.window as AggWindow, query.limit);

      return reply.send({
        ok: true,
        data: {
          window: query.window,
          count: activities.length,
          activities,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Aggregation Routes] Activities failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/aggregation/bridges
   * Get bridge aggregates
   */
  app.get('/api/aggregation/bridges', async (
    request: FastifyRequest<{ Querystring: z.infer<typeof WindowQuerySchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const query = WindowQuerySchema.parse(request.query || {});
      const bridges = await getBridges(query.window as AggWindow, query.limit);

      return reply.send({
        ok: true,
        data: {
          window: query.window,
          count: bridges.length,
          bridges,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Aggregation Routes] Bridges failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  console.log('[Aggregation] Routes registered: /api/aggregation/*');
}
