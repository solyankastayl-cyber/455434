/**
 * Admin Providers Routes
 * 
 * Provider management endpoints:
 * - GET /admin/providers/status (ADMIN, MODERATOR)
 * - POST /admin/providers/add (ADMIN only)
 * - DELETE /admin/providers/:id (ADMIN only)
 * - POST /admin/providers/reset-all (ADMIN only)
 * 
 * All write operations are logged to audit log.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from './admin.middleware.js';
import { logAdminAction } from './admin.audit.js';
import { getProviderPool, ProviderConfig } from '../providers/provider_pool.service.js';

export async function adminProvidersRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /admin/providers/status
   * Get status of all external providers
   * Access: ADMIN, MODERATOR
   */
  app.get('/providers/status', {
    preHandler: requireAdminAuth(['ADMIN', 'MODERATOR']),
  }, async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const pool = getProviderPool();
      const status = pool.getStatus();
      
      return reply.send({
        ok: true,
        data: {
          providers: status,
          summary: {
            total: status.length,
            healthy: status.filter(p => p.healthy).length,
            inCooldown: status.filter(p => !p.healthy).length,
            totalRequests: status.reduce((sum, p) => sum + p.requestCount, 0),
            totalErrors: status.reduce((sum, p) => sum + p.errorCount, 0),
          },
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'PROVIDER_STATUS_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/providers/reset-all
   * Reset all providers (clear cooldowns)
   * Access: ADMIN only
   */
  app.post('/providers/reset-all', {
    preHandler: requireAdminAuth(['ADMIN']),
  }, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const pool = getProviderPool();
      pool.reset();
      
      // Audit log
      await logAdminAction({
        adminId: request.admin!.sub,
        action: 'PROVIDER_RESET_ALL',
        ip: request.ip,
      });
      
      return reply.send({
        ok: true,
        message: 'All providers reset',
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'RESET_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/providers/add
   * Add new provider configuration
   * Access: ADMIN only
   */
  app.post('/providers/add', {
    preHandler: requireAdminAuth(['ADMIN']),
  }, async (
    request: FastifyRequest<{ Body: Partial<ProviderConfig> }>,
    reply: FastifyReply
  ) => {
    try {
      const { id, type, baseUrl, apiKey, weight, cooldownMs, rateLimit } = request.body || {} as any;
      
      if (!id || !type || !baseUrl) {
        return reply.code(400).send({
          ok: false,
          error: 'BAD_REQUEST',
          message: 'id, type, and baseUrl required',
        });
      }
      
      const pool = getProviderPool();
      
      pool.addProvider({
        id,
        type,
        baseUrl,
        apiKey,
        weight: weight || 1,
        cooldownMs: cooldownMs || 60000,
        rateLimit: rateLimit || { requestsPerMinute: 30 },
      });
      
      // Audit log (without apiKey for security)
      await logAdminAction({
        adminId: request.admin!.sub,
        action: 'PROVIDER_ADD',
        resource: id,
        payload: { id, type, baseUrl, weight },
        ip: request.ip,
      });
      
      return reply.send({
        ok: true,
        message: `Provider ${id} added`,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'ADD_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * DELETE /admin/providers/:id
   * Remove a provider
   * Access: ADMIN only
   */
  app.delete('/providers/:id', {
    preHandler: requireAdminAuth(['ADMIN']),
  }, async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const pool = getProviderPool();
      
      pool.removeProvider(id);
      
      // Audit log
      await logAdminAction({
        adminId: request.admin!.sub,
        action: 'PROVIDER_REMOVE',
        resource: id,
        ip: request.ip,
      });
      
      return reply.send({
        ok: true,
        message: `Provider ${id} removed`,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'REMOVE_ERROR',
        message: error.message,
      });
    }
  });

  app.log.info('[Admin] Providers routes registered (with audit logging)');
}

export default adminProvidersRoutes;
