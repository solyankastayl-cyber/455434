/**
 * Admin ML Routes
 * 
 * ML runtime control endpoints:
 * - GET /admin/ml/status (ADMIN, MODERATOR)
 * - POST /admin/ml/toggle (ADMIN only)
 * - POST /admin/ml/policy (ADMIN only)
 * - POST /admin/ml/reload (ADMIN only)
 * - GET /admin/ml/models (ADMIN, MODERATOR)
 * - POST /admin/ml/models/toggle (ADMIN only)
 * 
 * MODERATOR: Read-only access to status endpoints
 * ADMIN: Full control
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from './admin.middleware.js';
import { logAdminAction } from './admin.audit.js';
import {
  getMLStatus,
  getPolicy,
  updatePolicy,
  resetCircuitBreaker,
  getModelStatus,
} from '../ml/ml_policy.js';
import { checkPythonHealth } from '../ml/ml_python_client.js';
import { getInferenceStats } from '../ml/ml_inference_log.model.js';

// Simple in-memory cache for status endpoints
let statusCache: { data: any; expiresAt: number } | null = null;
const STATUS_CACHE_TTL_MS = 2000; // 2 seconds

export async function adminMlRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /admin/ml/status
   * Full ML runtime status (cached 2s)
   * Access: ADMIN, MODERATOR
   */
  app.get('/ml/status', {
    preHandler: requireAdminAuth(['ADMIN', 'MODERATOR']),
  }, async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      // Check cache
      if (statusCache && Date.now() < statusCache.expiresAt) {
        return reply.send(statusCache.data);
      }
      
      const status = getMLStatus();
      
      // Check Python health
      const pythonHealthy = await checkPythonHealth();
      status.ml.pythonService.healthy = pythonHealthy;
      
      // Get inference stats for last hour
      const [marketStats, actorStats] = await Promise.all([
        getInferenceStats('ethereum', 'market', 3600),
        getInferenceStats('ethereum', 'actor', 3600),
      ]);
      
      const response = {
        ok: true,
        data: {
          ...status,
          inferenceStats: {
            market: marketStats,
            actor: actorStats,
          },
        },
      };
      
      // Update cache
      statusCache = {
        data: response,
        expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
      };
      
      return reply.send(response);
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'ML_STATUS_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/ml/toggle
   * Enable/disable ML (Python service)
   * Access: ADMIN only
   */
  app.post('/ml/toggle', {
    preHandler: requireAdminAuth(['ADMIN']), // ADMIN only
  }, async (
    request: FastifyRequest<{ Body: { enabled: boolean } }>,
    reply: FastifyReply
  ) => {
    try {
      const { enabled } = request.body || {} as any;
      
      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({
          ok: false,
          error: 'BAD_REQUEST',
          message: 'enabled (boolean) required',
        });
      }
      
      updatePolicy({ pythonEnabled: enabled });
      
      // Invalidate cache
      statusCache = null;
      
      // Audit log
      await logAdminAction({
        adminId: request.admin!.sub,
        action: 'ML_TOGGLE',
        payload: { enabled },
        ip: request.ip,
      });
      
      return reply.send({
        ok: true,
        message: enabled ? 'ML enabled' : 'ML disabled (fallback mode)',
        pythonEnabled: enabled,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'TOGGLE_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/ml/policy
   * Update ML runtime policy
   * Access: ADMIN only
   */
  app.post('/ml/policy', {
    preHandler: requireAdminAuth(['ADMIN']), // ADMIN only
  }, async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    try {
      const updates = request.body || {};
      
      // Validate allowed fields
      const allowedFields = [
        'pythonEnabled',
        'marketModelEnabled',
        'actorModelEnabled',
        'timeoutMs',
        'retry',
        'circuitBreaker',
      ];
      
      const filtered: any = {};
      for (const key of Object.keys(updates)) {
        if (allowedFields.includes(key)) {
          filtered[key] = updates[key];
        }
      }
      
      if (Object.keys(filtered).length === 0) {
        return reply.code(400).send({
          ok: false,
          error: 'BAD_REQUEST',
          message: `Allowed fields: ${allowedFields.join(', ')}`,
        });
      }
      
      updatePolicy(filtered);
      statusCache = null;
      
      // Audit log
      await logAdminAction({
        adminId: request.admin!.sub,
        action: 'ML_POLICY_UPDATE',
        payload: filtered,
        ip: request.ip,
      });
      
      return reply.send({
        ok: true,
        message: 'Policy updated',
        policy: getPolicy(),
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'POLICY_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/ml/circuit-breaker/reset
   * Reset circuit breaker
   * Access: ADMIN only
   */
  app.post('/ml/circuit-breaker/reset', {
    preHandler: requireAdminAuth(['ADMIN']), // ADMIN only
  }, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      resetCircuitBreaker();
      statusCache = null;
      
      // Audit log
      await logAdminAction({
        adminId: request.admin!.sub,
        action: 'CIRCUIT_BREAKER_RESET',
        ip: request.ip,
      });
      
      return reply.send({
        ok: true,
        message: 'Circuit breaker reset',
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
   * GET /admin/ml/models
   * Get model versions and status
   * Access: ADMIN, MODERATOR
   */
  app.get('/ml/models', {
    preHandler: requireAdminAuth(['ADMIN', 'MODERATOR']),
  }, async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const marketModel = getModelStatus('market');
      const actorModel = getModelStatus('actor');
      
      return reply.send({
        ok: true,
        data: {
          models: {
            market: marketModel,
            actor: actorModel,
          },
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'MODELS_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/ml/models/toggle
   * Enable/disable specific model
   * Access: ADMIN only
   */
  app.post('/ml/models/toggle', {
    preHandler: requireAdminAuth(['ADMIN']), // ADMIN only
  }, async (
    request: FastifyRequest<{ Body: { model: string; enabled: boolean } }>,
    reply: FastifyReply
  ) => {
    try {
      const { model, enabled } = request.body || {} as any;
      
      if (!model || typeof enabled !== 'boolean') {
        return reply.code(400).send({
          ok: false,
          error: 'BAD_REQUEST',
          message: 'model and enabled required',
        });
      }
      
      if (model === 'market') {
        updatePolicy({ marketModelEnabled: enabled });
      } else if (model === 'actor') {
        updatePolicy({ actorModelEnabled: enabled });
      } else {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_MODEL',
          message: 'Model must be "market" or "actor"',
        });
      }
      
      statusCache = null;
      
      // Audit log
      await logAdminAction({
        adminId: request.admin!.sub,
        action: 'ML_MODEL_TOGGLE',
        resource: model,
        payload: { enabled },
        ip: request.ip,
      });
      
      return reply.send({
        ok: true,
        message: `Model ${model} ${enabled ? 'enabled' : 'disabled'}`,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'TOGGLE_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/ml/reload
   * Reload Python ML models
   * Access: ADMIN only
   */
  app.post('/ml/reload', {
    preHandler: requireAdminAuth(['ADMIN']), // ADMIN only
  }, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      // Call Python service reload endpoint
      const response = await fetch('http://localhost:8002/api/p35/reload', {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error(`Python service returned ${response.status}`);
      }
      
      const data = await response.json();
      statusCache = null;
      
      // Audit log
      await logAdminAction({
        adminId: request.admin!.sub,
        action: 'ML_RELOAD',
        payload: data,
        ip: request.ip,
      });
      
      return reply.send({
        ok: true,
        message: 'Models reloaded',
        data,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'RELOAD_ERROR',
        message: error.message,
      });
    }
  });

  app.log.info('[Admin] ML routes registered (with audit logging)');
}

export default adminMlRoutes;
