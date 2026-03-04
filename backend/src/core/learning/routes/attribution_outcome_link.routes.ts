/**
 * Attribution Outcome Link Routes
 * 
 * ETAP 3.3: API endpoints for attribution → outcome linking.
 * 
 * Read-only + manual trigger. NO side effects on Ranking/Engine.
 * 
 * Endpoints:
 * - GET /api/learning/links - List links with filters
 * - GET /api/learning/links/stats - Statistics
 * - GET /api/learning/links/pending - Pending counts per horizon
 * - GET /api/learning/links/:snapshotId/:horizon - Get specific link
 * - GET /api/learning/links/token/:address - Get by token
 * - POST /api/learning/links/run - Manual run (single horizon)
 * - POST /api/learning/links/run-all - Manual run (all horizons)
 * - GET /api/learning/links/worker/status - Worker status
 * - POST /api/learning/links/worker/start - Start worker
 * - POST /api/learning/links/worker/stop - Stop worker
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getLinkBySnapshotAndHorizon,
  getLinksByToken,
  getLinkStats,
  getPendingForLinking,
} from '../services/attribution_outcome_link.service.js';
import {
  startAttributionWorker,
  stopAttributionWorker,
  getAttributionWorkerStatus,
  runAttributionWorkerOnce,
  runAttributionWorkerAll,
} from '../workers/attribution_outcome_link.worker.js';
import { AttributionOutcomeLinkModel } from '../models/attribution_outcome_link.model.js';
import type { Horizon } from '../learning.types.js';

// ==================== ROUTE HANDLERS ====================

export async function attributionLinkRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/learning/links
   * List attribution links with filters
   */
  app.get('/learning/links', async (
    request: FastifyRequest<{
      Querystring: {
        token?: string;
        horizon?: string;
        verdict?: string;
        bucket?: string;
        limit?: string;
        offset?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { token, horizon, verdict, bucket, limit = '50', offset = '0' } = request.query;
      
      const query: any = {};
      if (token) query.tokenAddress = token.toLowerCase();
      if (horizon) query.horizon = horizon;
      if (verdict) query.verdict = verdict;
      if (bucket) query.bucketAtDecision = bucket;
      
      const [links, total] = await Promise.all([
        AttributionOutcomeLinkModel.find(query)
          .sort({ linkedAt: -1 })
          .skip(parseInt(offset))
          .limit(parseInt(limit))
          .lean(),
        AttributionOutcomeLinkModel.countDocuments(query),
      ]);
      
      return reply.send({
        ok: true,
        data: {
          links: links.map(l => ({
            ...l,
            _id: undefined,
          })),
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/links/stats
   * Get link statistics
   */
  app.get('/learning/links/stats', async (
    request: FastifyRequest<{
      Querystring: { horizon?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = request.query.horizon as Horizon | undefined;
      const stats = await getLinkStats(horizon);
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/links/pending
   * Get pending counts per horizon
   */
  app.get('/learning/links/pending', async (_request, reply: FastifyReply) => {
    try {
      const horizons: Horizon[] = ['1d', '7d', '30d'];
      const pendingCounts: Record<string, number> = {};
      
      for (const h of horizons) {
        const pending = await getPendingForLinking(h, 1000);
        pendingCounts[h] = pending.length;
      }
      
      return reply.send({
        ok: true,
        data: {
          pending: pendingCounts,
          total: Object.values(pendingCounts).reduce((a, b) => a + b, 0),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/links/:snapshotId/:horizon
   * Get specific link
   */
  app.get('/learning/links/:snapshotId/:horizon', async (
    request: FastifyRequest<{
      Params: { snapshotId: string; horizon: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { snapshotId, horizon } = request.params;
      const link = await getLinkBySnapshotAndHorizon(snapshotId, horizon as Horizon);
      
      if (!link) {
        return reply.status(404).send({
          ok: false,
          error: 'Link not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: { ...link, _id: undefined },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/links/token/:address
   * Get links by token address
   */
  app.get('/learning/links/token/:address', async (
    request: FastifyRequest<{
      Params: { address: string };
      Querystring: { horizon?: string; limit?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { address } = request.params;
      const { horizon, limit = '50' } = request.query;
      
      const links = await getLinksByToken(
        address,
        horizon as Horizon | undefined,
        parseInt(limit)
      );
      
      return reply.send({
        ok: true,
        data: {
          links: links.map(l => ({
            ...l,
            _id: undefined,
          })),
          count: links.length,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ==================== WORKER ENDPOINTS ====================
  
  /**
   * GET /api/learning/links/worker/status
   * Get attribution worker status
   */
  app.get('/learning/links/worker/status', async (_request, reply: FastifyReply) => {
    try {
      const status = await getAttributionWorkerStatus();
      return reply.send({
        ok: true,
        data: status,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/learning/links/worker/start
   * Start attribution worker
   */
  app.post('/learning/links/worker/start', async (_request, reply: FastifyReply) => {
    try {
      const result = startAttributionWorker();
      return reply.send({
        ok: result.success,
        message: result.message,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/learning/links/worker/stop
   * Stop attribution worker
   */
  app.post('/learning/links/worker/stop', async (_request, reply: FastifyReply) => {
    try {
      const result = stopAttributionWorker();
      return reply.send({
        ok: result.success,
        message: result.message,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/learning/links/run
   * Run attribution linking cycle manually (single horizon)
   */
  app.post('/learning/links/run', async (
    request: FastifyRequest<{
      Querystring: { horizon?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = request.query.horizon as Horizon | undefined;
      const result = await runAttributionWorkerOnce(horizon);
      return reply.send({
        ok: result.success,
        data: result.result,
        error: result.error,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/learning/links/run-all
   * Run attribution linking cycle for all horizons
   */
  app.post('/learning/links/run-all', async (_request, reply: FastifyReply) => {
    try {
      const result = await runAttributionWorkerAll();
      return reply.send({
        ok: result.success,
        data: {
          results: result.results,
          totalCreated: result.totalCreated,
          totalErrors: result.totalErrors,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  app.log.info('[AttributionLink] Routes registered: /api/learning/links/*');
}
