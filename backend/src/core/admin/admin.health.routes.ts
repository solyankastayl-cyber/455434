/**
 * Admin Health Routes
 * 
 * System health and dashboard overview:
 * - GET /admin/health
 * - GET /admin/dashboard (cached 5s)
 * - GET /admin/audit-log
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from './admin.middleware.js';
import { getProviderPool } from '../providers/provider_pool.service.js';
import { getMLStatus, getPythonHealth } from '../ml/ml_policy.js';
import { checkPythonHealth } from '../ml/ml_python_client.js';
import { getJobStatus, getSnapshotStats } from '../price/price_snapshot.job.js';
import { getUniverseStats } from '../price/token_universe.model.js';
import { getCacheStats } from '../price/price.service.js';
import { getInferenceStats } from '../ml/ml_inference_log.model.js';
import { getRecentAuditLogs, getAuditStats } from './admin.audit.js';

// Dashboard cache (5 seconds)
let dashboardCache: { data: any; expiresAt: number } | null = null;
const DASHBOARD_CACHE_TTL_MS = 5000;

export async function adminHealthRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /admin/health
   * Quick health check
   * Access: ADMIN, MODERATOR
   */
  app.get('/health', {
    preHandler: requireAdminAuth(['ADMIN', 'MODERATOR']),
  }, async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const providerPool = getProviderPool();
      const providerStatus = providerPool.getStatus();
      const pythonHealthy = await checkPythonHealth();
      const mlStatus = getMLStatus();
      
      const healthStatus = {
        overall: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
        checks: {
          providers: providerStatus.filter(p => p.healthy).length > 0,
          pythonML: pythonHealthy,
          database: true, // Mongoose connected
        },
      };
      
      // Determine overall status
      if (!healthStatus.checks.providers || !healthStatus.checks.pythonML) {
        healthStatus.overall = 'degraded';
      }
      if (!healthStatus.checks.database) {
        healthStatus.overall = 'unhealthy';
      }
      
      return reply.send({
        ok: true,
        data: {
          status: healthStatus.overall,
          checks: healthStatus.checks,
          timestamp: Date.now(),
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'HEALTH_CHECK_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * GET /admin/dashboard
   * Full dashboard data (cached 5s)
   * Access: ADMIN, MODERATOR
   */
  app.get('/dashboard', {
    preHandler: requireAdminAuth(['ADMIN', 'MODERATOR']),
  }, async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      // Check cache
      if (dashboardCache && Date.now() < dashboardCache.expiresAt) {
        return reply.send(dashboardCache.data);
      }
      
      // Gather all data in parallel
      const [
        providerStatus,
        pythonHealthy,
        mlStatus,
        priceJobStatus,
        snapshotStats,
        universeStats,
        cacheStats,
        marketInferenceStats,
        auditStats,
      ] = await Promise.all([
        Promise.resolve(getProviderPool().getStatus()),
        checkPythonHealth(),
        Promise.resolve(getMLStatus()),
        Promise.resolve(getJobStatus()),
        getSnapshotStats(),
        getUniverseStats(),
        Promise.resolve(getCacheStats()),
        getInferenceStats('ethereum', 'market', 3600),
        getAuditStats(86400), // Last 24h
      ]);
      
      const response = {
        ok: true,
        data: {
          providers: {
            list: providerStatus,
            summary: {
              total: providerStatus.length,
              healthy: providerStatus.filter(p => p.healthy).length,
              totalRequests: providerStatus.reduce((s, p) => s + p.requestCount, 0),
              totalErrors: providerStatus.reduce((s, p) => s + p.errorCount, 0),
            },
          },
          ml: {
            pythonHealthy,
            ...mlStatus.ml,
            inferenceStats: marketInferenceStats,
          },
          price: {
            job: priceJobStatus,
            snapshots: snapshotStats,
            universe: universeStats,
            cache: cacheStats,
          },
          audit: auditStats,
          timestamp: Date.now(),
        },
      };
      
      // Update cache
      dashboardCache = {
        data: response,
        expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
      };
      
      return reply.send(response);
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'DASHBOARD_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * GET /admin/audit-log
   * Recent admin actions
   * Access: ADMIN only
   */
  app.get('/audit-log', {
    preHandler: requireAdminAuth(['ADMIN']),
  }, async (
    request: FastifyRequest<{ Querystring: { limit?: string; action?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const limit = Math.min(parseInt(request.query.limit || '50'), 200);
      const action = request.query.action;
      
      const logs = await getRecentAuditLogs(limit, action ? { action: action as any } : undefined);
      const stats = await getAuditStats(86400);
      
      return reply.send({
        ok: true,
        data: {
          logs: logs.map(l => ({
            ts: l.ts,
            adminId: l.adminId,
            adminUsername: l.adminUsername,
            action: l.action,
            resource: l.resource,
            result: l.result,
            ip: l.ip,
          })),
          stats,
          count: logs.length,
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'AUDIT_LOG_ERROR',
        message: error.message,
      });
    }
  });

  /**
   * GET /admin/logs/inference
   * Recent ML inference logs
   * Access: ADMIN, MODERATOR
   */
  app.get('/logs/inference', {
    preHandler: requireAdminAuth(['ADMIN', 'MODERATOR']),
  }, async (
    request: FastifyRequest<{ Querystring: { network?: string; limit?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { MLInferenceLogModel } = await import('../ml/ml_inference_log.model.js');
      
      const network = request.query.network || 'ethereum';
      const limit = Math.min(parseInt(request.query.limit || '50'), 100);
      
      const logs = await MLInferenceLogModel.find({ network })
        .sort({ ts: -1 })
        .limit(limit)
        .lean();
      
      return reply.send({
        ok: true,
        data: {
          logs: logs.map(l => ({
            ts: l.ts,
            signalType: l.signalType,
            modelVersion: l.modelVersion,
            wasFallback: l.wasFallback,
            result: l.result,
            latencyMs: l.latencyMs,
          })),
          count: logs.length,
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'LOGS_ERROR',
        message: error.message,
      });
    }
  });

  app.log.info('[Admin] Health routes registered (with caching)');
}

export default adminHealthRoutes;
