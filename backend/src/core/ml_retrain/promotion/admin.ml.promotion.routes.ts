/**
 * BATCH 4: Admin ML Promotion Routes
 * 
 * API для promotion и rollback:
 * - POST /api/admin/ml/promote - SHADOW → ACTIVE
 * - POST /api/admin/ml/rollback - к предыдущей версии
 * - GET /api/admin/ml/promotion/candidates - кандидаты на promotion
 * - GET /api/admin/ml/promotion/rollback-targets - доступные версии для rollback
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from '../../admin/admin.middleware.js';
import { PromotionService } from './promotion.service.js';

interface PromoteBody {
  task: 'market' | 'actor';
  modelVersion: string;
}

interface RollbackBody {
  task: 'market' | 'actor';
  toVersion?: string;
}

interface TaskQuery {
  task?: 'market' | 'actor';
}

export async function adminMlPromotionRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /ml/promote
   * Promote SHADOW model to ACTIVE (requires PASS verdict)
   */
  app.post<{ Body: PromoteBody }>(
    '/ml/promote',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Body: PromoteBody }>, reply: FastifyReply) => {
      const { task, modelVersion } = request.body;

      if (!task || !modelVersion) {
        return reply.code(400).send({
          ok: false,
          error: 'MISSING_PARAMS',
          message: 'task and modelVersion are required',
        });
      }

      const result = await PromotionService.promote(task, modelVersion);

      if (!result.ok) {
        return reply.code(400).send(result);
      }

      return reply.send(result);
    }
  );

  /**
   * POST /ml/rollback
   * Rollback to previous ACTIVE model
   */
  app.post<{ Body: RollbackBody }>(
    '/ml/rollback',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Body: RollbackBody }>, reply: FastifyReply) => {
      const { task, toVersion } = request.body;

      if (!task) {
        return reply.code(400).send({
          ok: false,
          error: 'MISSING_PARAMS',
          message: 'task is required',
        });
      }

      const result = await PromotionService.rollback(task, toVersion);

      if (!result.ok) {
        return reply.code(400).send(result);
      }

      return reply.send(result);
    }
  );

  /**
   * GET /ml/promotion/candidates
   * Get SHADOW models that can be promoted (have PASS verdict)
   */
  app.get<{ Querystring: TaskQuery }>(
    '/ml/promotion/candidates',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: TaskQuery }>, reply: FastifyReply) => {
      const task = request.query.task || 'market';
      const result = await PromotionService.getCandidates(task);
      return reply.send(result);
    }
  );

  /**
   * GET /ml/promotion/rollback-targets
   * Get ARCHIVED models available for rollback
   */
  app.get<{ Querystring: TaskQuery }>(
    '/ml/promotion/rollback-targets',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: TaskQuery }>, reply: FastifyReply) => {
      const task = request.query.task || 'market';
      const result = await PromotionService.getRollbackTargets(task);
      return reply.send(result);
    }
  );

  /**
   * GET /ml/promotion/active
   * Get current ACTIVE model version
   */
  app.get<{ Querystring: TaskQuery }>(
    '/ml/promotion/active',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: TaskQuery }>, reply: FastifyReply) => {
      const task = request.query.task || 'market';
      const version = await PromotionService.getActiveVersion(task);
      return reply.send({
        ok: true,
        task,
        activeVersion: version,
      });
    }
  );

  app.log.info('[BATCH 4] Admin ML Promotion routes registered');
}
