/**
 * Data Pipelines Routes
 * 
 * GET /api/admin/data/pipelines - Pipeline status
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from './admin.middleware.js';
import { getPipelinesStatus } from './pipelines.service.js';

export async function adminPipelinesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin/data/pipelines
   * Returns all pipeline stages status
   */
  app.get(
    '/data/pipelines',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await getPipelinesStatus();
        return reply.send({ ok: true, data });
      } catch (err: any) {
        console.error('[AdminPipelines] Error getting status:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'INTERNAL_ERROR',
          message: 'Failed to get pipelines status',
        });
      }
    }
  );
  
  console.log('[Admin] Pipelines routes registered');
}

export default adminPipelinesRoutes;
