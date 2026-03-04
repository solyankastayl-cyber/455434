/**
 * Trend Validation Routes
 * 
 * ETAP 3.2: API endpoints for trend validation.
 * 
 * Read-only + manual trigger. NO side effects on Ranking/Engine.
 * 
 * Endpoints:
 * - GET /api/learning/trends - List trend validations
 * - GET /api/learning/trends/stats - Statistics
 * - GET /api/learning/trends/pending - Pending validations count
 * - GET /api/learning/trends/:snapshotId - Get by snapshot ID
 * - GET /api/learning/trends/token/:address - Get by token
 * - POST /api/learning/trends/run - Manual validation run
 * - GET /api/learning/trends/worker/status - Worker status
 * - POST /api/learning/trends/worker/start - Start worker
 * - POST /api/learning/trends/worker/stop - Stop worker
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getValidationBySnapshotId,
  getValidationsByToken,
  getValidationStats,
  getPendingValidation,
} from '../services/trend-validation.service.js';
import {
  startTrendWorker,
  stopTrendWorker,
  getTrendWorkerStatus,
  runTrendWorkerOnce,
} from '../workers/trend-validation.worker.js';
import { TrendValidationModel } from '../models/trend_validation.model.js';

// ==================== ROUTE HANDLERS ====================

export async function trendRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/learning/trends
   * List trend validations with pagination
   */
  app.get('/learning/trends', async (
    request: FastifyRequest<{
      Querystring: {
        token?: string;
        label?: string;
        delay?: string;
        limit?: string;
        offset?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { token, label, delay, limit = '50', offset = '0' } = request.query;
      
      const query: any = {};
      if (token) query.tokenAddress = token.toLowerCase();
      if (label) query['final.label'] = label;
      if (delay) query['final.delay'] = delay;
      
      const [validations, total] = await Promise.all([
        TrendValidationModel.find(query)
          .sort({ validatedAt: -1 })
          .skip(parseInt(offset))
          .limit(parseInt(limit))
          .lean(),
        TrendValidationModel.countDocuments(query),
      ]);
      
      return reply.send({
        ok: true,
        data: {
          validations: validations.map(v => ({
            ...v,
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
   * GET /api/learning/trends/stats
   * Get validation statistics
   */
  app.get('/learning/trends/stats', async (_request, reply: FastifyReply) => {
    try {
      const stats = await getValidationStats();
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
   * GET /api/learning/trends/pending
   * Get pending validation count
   */
  app.get('/learning/trends/pending', async (
    request: FastifyRequest<{
      Querystring: { limit?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const limit = parseInt(request.query.limit || '100');
      const pending = await getPendingValidation(limit);
      
      return reply.send({
        ok: true,
        data: {
          pending: pending.length,
          snapshotIds: pending.slice(0, 10), // Show first 10
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
   * GET /api/learning/trends/:snapshotId
   * Get validation by snapshot ID
   */
  app.get('/learning/trends/:snapshotId', async (
    request: FastifyRequest<{
      Params: { snapshotId: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const validation = await getValidationBySnapshotId(request.params.snapshotId);
      
      if (!validation) {
        return reply.status(404).send({
          ok: false,
          error: 'Validation not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: { ...validation, _id: undefined },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/trends/token/:address
   * Get validations by token address
   */
  app.get('/learning/trends/token/:address', async (
    request: FastifyRequest<{
      Params: { address: string };
      Querystring: { limit?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const limit = parseInt(request.query.limit || '50');
      const validations = await getValidationsByToken(request.params.address, limit);
      
      return reply.send({
        ok: true,
        data: {
          validations: validations.map(v => ({
            ...v,
            _id: undefined,
          })),
          count: validations.length,
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
   * GET /api/learning/trends/worker/status
   * Get trend worker status
   */
  app.get('/learning/trends/worker/status', async (_request, reply: FastifyReply) => {
    try {
      const status = await getTrendWorkerStatus();
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
   * POST /api/learning/trends/worker/start
   * Start trend worker
   */
  app.post('/learning/trends/worker/start', async (_request, reply: FastifyReply) => {
    try {
      const result = startTrendWorker();
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
   * POST /api/learning/trends/worker/stop
   * Stop trend worker
   */
  app.post('/learning/trends/worker/stop', async (_request, reply: FastifyReply) => {
    try {
      const result = stopTrendWorker();
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
   * POST /api/learning/trends/run
   * Run trend validation cycle manually
   */
  app.post('/learning/trends/run', async (_request, reply: FastifyReply) => {
    try {
      const result = await runTrendWorkerOnce();
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
  
  app.log.info('[Trend] Routes registered: /api/learning/trends/*');
}
