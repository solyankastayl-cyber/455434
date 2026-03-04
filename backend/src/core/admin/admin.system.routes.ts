/**
 * System Overview Routes
 * 
 * GET /api/admin/system/overview - Full system status
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from './admin.middleware.js';
import { getSystemOverview, updateRuntimeConfig, RuntimeStatus } from './system_overview.service.js';
import { logAdminAction } from './admin.audit.js';

export async function adminSystemRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin/system/overview
   * Returns full system operational status
   */
  app.get(
    '/system/overview',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await getSystemOverview();
        return reply.send({ ok: true, data });
      } catch (err: any) {
        console.error('[AdminSystem] Error getting overview:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'INTERNAL_ERROR',
          message: 'Failed to get system overview',
        });
      }
    }
  );
  
  /**
   * POST /admin/system/runtime
   * Update runtime configuration
   */
  app.post(
    '/system/runtime',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const adminCtx = (request as any).adminContext;
      
      // Only ADMIN can modify runtime
      if (adminCtx?.role !== 'ADMIN') {
        return reply.code(403).send({
          ok: false,
          error: 'FORBIDDEN',
          message: 'Only ADMIN role can modify runtime settings',
        });
      }
      
      try {
        const updates = request.body as Partial<RuntimeStatus>;
        const newConfig = updateRuntimeConfig(updates);
        
        // Audit log
        await logAdminAction({
          adminId: adminCtx.userId,
          adminUsername: adminCtx.username,
          action: 'RUNTIME_UPDATE',
          resource: 'system/runtime',
          payload: updates,
          result: 'success',
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        });
        
        return reply.send({
          ok: true,
          message: 'Runtime configuration updated',
          data: newConfig,
        });
      } catch (err: any) {
        console.error('[AdminSystem] Error updating runtime:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'INTERNAL_ERROR',
          message: 'Failed to update runtime configuration',
        });
      }
    }
  );
  
  console.log('[Admin] System routes registered');
}

export default adminSystemRoutes;
