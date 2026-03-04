/**
 * BATCH 3: Admin ML Shadow Routes
 * 
 * API для shadow evaluation:
 * - POST /api/admin/ml/shadow/evaluate - запуск сравнения
 * - GET /api/admin/ml/shadow/latest - последний результат
 * - GET /api/admin/ml/shadow/history - история сравнений
 * - GET /api/admin/ml/shadow/summary - сводка по всем сетям
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from '../../admin/admin.middleware.js';
import { ShadowRunnerService } from './shadow_runner.service.js';
import type { MlTask } from './ml_shadow_comparison.model.js';

interface EvaluateBody {
  task?: MlTask;
  network: string;
  shadowModelVersion?: string;
  activeModelVersion?: string;
  limit?: number;
  windowLabel?: string;
}

interface QueryParams {
  task?: MlTask;
  network?: string;
  limit?: number;
}

export async function adminMlShadowRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /ml/shadow/evaluate
   * Run shadow evaluation comparing ACTIVE vs SHADOW
   */
  app.post<{ Body: EvaluateBody }>(
    '/ml/shadow/evaluate',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Body: EvaluateBody }>, reply: FastifyReply) => {
      const { task = 'market', network, shadowModelVersion, activeModelVersion, limit, windowLabel } = request.body;

      if (!network) {
        return reply.code(400).send({
          ok: false,
          error: 'NETWORK_REQUIRED',
          message: 'network is required'
        });
      }

      try {
        const result = await ShadowRunnerService.evaluate({
          task,
          network,
          shadowModelVersion,
          activeModelVersion,
          limit,
          windowLabel,
        });

        return reply.send(result);
      } catch (err: any) {
        console.error('[ShadowRoutes] Evaluate error:', err);
        return reply.code(500).send({
          ok: false,
          error: 'EVALUATION_FAILED',
          message: err.message
        });
      }
    }
  );

  /**
   * GET /ml/shadow/latest
   * Get latest comparison result for task/network
   */
  app.get<{ Querystring: QueryParams }>(
    '/ml/shadow/latest',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: QueryParams }>, reply: FastifyReply) => {
      const { task = 'market', network } = request.query;

      if (!network) {
        return reply.code(400).send({
          ok: false,
          error: 'NETWORK_REQUIRED',
          message: 'network query param is required'
        });
      }

      const result = await ShadowRunnerService.getLatest(task, network);
      return reply.send(result);
    }
  );

  /**
   * GET /ml/shadow/history
   * Get comparison history for task/network
   */
  app.get<{ Querystring: QueryParams }>(
    '/ml/shadow/history',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: QueryParams }>, reply: FastifyReply) => {
      const { task = 'market', network, limit = 50 } = request.query;

      if (!network) {
        return reply.code(400).send({
          ok: false,
          error: 'NETWORK_REQUIRED',
          message: 'network query param is required'
        });
      }

      const result = await ShadowRunnerService.getHistory(task, network, limit);
      return reply.send(result);
    }
  );

  /**
   * GET /ml/shadow/summary
   * Get summary across all networks for a task
   */
  app.get<{ Querystring: { task?: MlTask } }>(
    '/ml/shadow/summary',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: { task?: MlTask } }>, reply: FastifyReply) => {
      const task = request.query.task || 'market';
      const result = await ShadowRunnerService.getSummary(task);
      return reply.send(result);
    }
  );

  app.log.info('[BATCH 3] Admin ML Shadow routes registered');
}
