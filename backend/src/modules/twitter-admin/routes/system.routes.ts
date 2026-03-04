/**
 * A.3.4 - System Health Routes
 * 
 * Admin endpoints for system monitoring:
 * - Overview metrics
 * - Problem sessions
 * - Users health
 * - Parser status
 * - Admin events feed
 */

import type { FastifyInstance } from 'fastify';
import { SystemHealthService } from '../services/system-health.service.js';
import { AdminEventType } from '../models/admin-event-log.model.js';

export async function registerSystemRoutes(app: FastifyInstance) {
  const healthService = new SystemHealthService();
  
  console.log('[BOOT] Registering system health routes');
  
  // ============================================
  // System Overview
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/system/overview
   * Get system-wide health metrics
   */
  app.get('/api/v4/admin/twitter/system/overview', async (req, reply) => {
    try {
      const overview = await healthService.getSystemOverview();
      
      return reply.send({
        ok: true,
        data: overview,
      });
    } catch (err: any) {
      app.log.error(err, 'System overview error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Sessions Health
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/system/sessions
   * Get problematic sessions
   * 
   * Query params:
   * - status: STALE | INVALID | OK
   * - limit: number (default 50)
   * - sort: risk | abort | sync
   */
  app.get('/api/v4/admin/twitter/system/sessions', async (req, reply) => {
    try {
      const query = req.query as {
        status?: string;
        limit?: string;
        sort?: string;
      };
      
      const status = query.status;
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const sort = query.sort || 'risk';
      
      const sessions = await healthService.getProblemSessions(status, limit, sort);
      
      return reply.send({
        ok: true,
        data: sessions,
      });
    } catch (err: any) {
      app.log.error(err, 'Get sessions error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Users Health
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/system/users/health
   * Get users health status
   * 
   * Query params:
   * - limit: number (default 50)
   * - sort: health | abortRate
   */
  app.get('/api/v4/admin/twitter/system/users/health', async (req, reply) => {
    try {
      const query = req.query as {
        limit?: string;
        sort?: string;
      };
      
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const sort = query.sort || 'health';
      
      const users = await healthService.getUsersHealth(limit, sort);
      
      return reply.send({
        ok: true,
        data: users,
      });
    } catch (err: any) {
      app.log.error(err, 'Get users health error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Parser Health
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/system/parsers
   * Get parser health status
   */
  app.get('/api/v4/admin/twitter/system/parsers', async (req, reply) => {
    try {
      const parserHealth = await healthService.getParserHealth();
      
      return reply.send({
        ok: true,
        data: {
          'twitter-parser-v2': parserHealth,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get parser health error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Admin Events Feed
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/system/admin-events
   * Get admin events feed (system monitoring)
   * 
   * Query params:
   * - limit: number (default 50)
   * - type: AdminEventType
   * - category: SYSTEM | POLICY | USER
   * - userId: string
   * - from: ISO date string
   * - to: ISO date string
   */
  app.get('/api/v4/admin/twitter/system/admin-events', async (req, reply) => {
    try {
      const query = req.query as {
        limit?: string;
        type?: AdminEventType;
        category?: 'SYSTEM' | 'POLICY' | 'USER';
        userId?: string;
        from?: string;
        to?: string;
      };
      
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      
      const events = await healthService.getAdminEventsFiltered({
        limit,
        type: query.type,
        category: query.category,
        userId: query.userId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      });
      
      return reply.send({
        ok: true,
        data: events,
      });
    } catch (err: any) {
      app.log.error(err, 'Get admin events error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/system/parser-status
   * Get current parser health status
   */
  app.get('/api/v4/admin/twitter/system/parser-status', async (req, reply) => {
    try {
      const { getParserStatus } = await import('../services/parser-health.monitor.js');
      const status = getParserStatus();
      
      return reply.send({
        ok: true,
        data: status,
      });
    } catch (err: any) {
      app.log.error(err, 'Get parser status error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/system/session-health
   * Get session health statistics
   */
  app.get('/api/v4/admin/twitter/system/session-health', async (req, reply) => {
    try {
      const { sessionHealthMonitor } = await import('../services/session-health.monitor.js');
      const stats = await sessionHealthMonitor.getHealthStats();
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (err: any) {
      app.log.error(err, 'Get session health stats error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/system/session-health/check
   * Trigger manual session health check
   */
  app.post('/api/v4/admin/twitter/system/session-health/check', async (req, reply) => {
    try {
      const { sessionHealthMonitor } = await import('../services/session-health.monitor.js');
      const results = await sessionHealthMonitor.checkAllSessions();
      
      return reply.send({
        ok: true,
        data: {
          checkedCount: results.length,
          statusChanges: results,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Session health check error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Phase 5.1 - System Tasks / Jobs
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/system/tasks
   * Get system tasks list
   * 
   * Query params:
   * - limit: number (default 50)
   * - status: PENDING | RUNNING | DONE | FAILED
   * - scope: SYSTEM | USER
   * - type: SEARCH | ACCOUNT_TWEETS | ACCOUNT_FOLLOWERS | ACCOUNT_SUMMARY
   */
  app.get('/api/v4/admin/twitter/system/tasks', async (req, reply) => {
    try {
      const { TwitterTaskModel } = await import('../../twitter/execution/queue/task.model.js');
      
      const query = req.query as {
        limit?: string;
        status?: string;
        scope?: string;
        type?: string;
      };
      
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      
      const filter: any = {};
      if (query.status) filter.status = query.status;
      if (query.scope) filter.scope = query.scope;
      if (query.type) filter.type = query.type;
      
      const tasks = await TwitterTaskModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      
      const formatted = tasks.map((t: any) => ({
        taskId: t._id.toString(),
        scope: t.scope,
        type: t.type,
        status: t.status,
        ownerUserId: t.ownerUserId,
        accountId: t.accountId,
        fetched: t.result?.fetched || 0,
        durationMs: t.completedAt && t.startedAt 
          ? new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime()
          : null,
        errorCode: t.lastErrorCode,
        lastError: t.lastError,
        retryCount: t.retryCount || 0,
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
      }));
      
      return reply.send({
        ok: true,
        data: {
          tasks: formatted,
          count: formatted.length,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get tasks error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Phase 5.1 - Worker Status
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/system/worker
   * Get worker and queue status
   */
  app.get('/api/v4/admin/twitter/system/worker', async (req, reply) => {
    try {
      const { mongoTaskWorker } = await import('../../twitter/execution/worker/mongo.worker.js');
      const status = await mongoTaskWorker.getStatus();
      
      return reply.send({
        ok: true,
        data: {
          worker: {
            status: status.running ? 'ONLINE' : 'OFFLINE',
            currentTasks: status.currentTasks,
            maxConcurrent: status.maxConcurrent,
          },
          queue: {
            pending: status.queueStats.pending,
            running: status.queueStats.running,
            done: status.queueStats.done,
            failed: status.queueStats.failed,
          },
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get worker status error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Phase 5.1 - Combined Health
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/system/health
   * Combined health status (parser + worker + queue)
   */
  app.get('/api/v4/admin/twitter/system/health', async (req, reply) => {
    try {
      const { mongoTaskWorker } = await import('../../twitter/execution/worker/mongo.worker.js');
      const workerStatus = await mongoTaskWorker.getStatus();
      const parserHealth = await healthService.getParserHealth();
      
      // Calculate abort rate
      const { TwitterTaskModel } = await import('../../twitter/execution/queue/task.model.js');
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const tasks1h = await TwitterTaskModel.countDocuments({ createdAt: { $gte: oneHourAgo } });
      const failed1h = await TwitterTaskModel.countDocuments({ 
        createdAt: { $gte: oneHourAgo }, 
        status: 'FAILED' 
      });
      
      const tasks24h = await TwitterTaskModel.countDocuments({ createdAt: { $gte: oneDayAgo } });
      const failed24h = await TwitterTaskModel.countDocuments({ 
        createdAt: { $gte: oneDayAgo }, 
        status: 'FAILED' 
      });
      
      return reply.send({
        ok: true,
        data: {
          parser: parserHealth.status,
          worker: workerStatus.running ? 'ONLINE' : 'IDLE',
          queueSize: workerStatus.queueStats.pending,
          abortRate1h: tasks1h > 0 ? Math.round((failed1h / tasks1h) * 100) : 0,
          abortRate24h: tasks24h > 0 ? Math.round((failed24h / tasks24h) * 100) : 0,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get health error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Phase 5.1 - Admin Actions
  // ============================================
  
  /**
   * POST /api/v4/admin/twitter/system/sessions/:sessionId/resync
   * Force resync for a specific session (invalidate and require re-sync)
   */
  app.post('/api/v4/admin/twitter/system/sessions/:sessionId/resync', async (req, reply) => {
    try {
      const { sessionId } = req.params as { sessionId: string };
      const { UserTwitterSessionModel } = await import('../../twitter-user/models/twitter-session.model.js');
      
      const session = await UserTwitterSessionModel.findById(sessionId);
      if (!session) {
        return reply.code(404).send({ 
          ok: false, 
          error: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        });
      }
      
      // Mark session as STALE to trigger re-sync
      session.status = 'STALE';
      session.riskScore = Math.min(100, (session.riskScore || 0) + 20);
      await session.save();
      
      return reply.send({
        ok: true,
        data: {
          sessionId: session._id.toString(),
          newStatus: session.status,
          message: 'Session marked for resync',
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Force resync error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/system/parse
   * Force parse task creation
   */
  app.post('/api/v4/admin/twitter/system/parse', async (req, reply) => {
    try {
      const body = req.body as {
        type: 'search' | 'account';
        query?: string;
        accountHandle?: string;
        limit?: number;
      };
      
      if (!body.type) {
        return reply.code(400).send({
          ok: false,
          error: 'MISSING_TYPE',
          message: 'type is required (search or account)',
        });
      }
      
      const { mongoTaskQueue } = await import('../../twitter/execution/queue/mongo.queue.js');
      const { ExecutionScope } = await import('../../twitter/core/execution-scope.js');
      
      let task;
      
      if (body.type === 'search') {
        if (!body.query) {
          return reply.code(400).send({
            ok: false,
            error: 'MISSING_QUERY',
            message: 'query is required for search type',
          });
        }
        
        task = await mongoTaskQueue.enqueue(
          'SEARCH',
          {
            query: body.query,
            limit: body.limit || 20,
            source: 'ADMIN_FORCE_PARSE',
          },
          { priority: 'HIGH' }
        );
      } else if (body.type === 'account') {
        if (!body.accountHandle) {
          return reply.code(400).send({
            ok: false,
            error: 'MISSING_ACCOUNT_HANDLE',
            message: 'accountHandle is required for account type',
          });
        }
        
        task = await mongoTaskQueue.enqueue(
          'ACCOUNT_TWEETS',
          {
            handle: body.accountHandle,
            limit: body.limit || 20,
            source: 'ADMIN_FORCE_PARSE',
          },
          { priority: 'HIGH' }
        );
      }
      
      return reply.send({
        ok: true,
        data: {
          taskId: task?._id?.toString(),
          type: body.type,
          status: 'PENDING',
          message: 'Task created successfully',
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Force parse error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/system/tasks/:taskId/retry
   * Retry a specific failed task
   */
  app.post('/api/v4/admin/twitter/system/tasks/:taskId/retry', async (req, reply) => {
    try {
      const { taskId } = req.params as { taskId: string };
      const { TwitterTaskModel, TaskStatus } = await import('../../twitter/execution/queue/task.model.js');
      
      const task = await TwitterTaskModel.findById(taskId);
      if (!task) {
        return reply.code(404).send({
          ok: false,
          error: 'TASK_NOT_FOUND',
          message: 'Task not found',
        });
      }
      
      if (task.status !== TaskStatus.FAILED) {
        return reply.code(400).send({
          ok: false,
          error: 'TASK_NOT_FAILED',
          message: 'Only failed tasks can be retried',
        });
      }
      
      // Reset task for retry
      task.status = TaskStatus.PENDING;
      task.retryCount = 0;
      task.lastError = undefined;
      task.lastErrorCode = undefined;
      task.nextRetryAt = undefined;
      task.lockedAt = undefined;
      task.lockedBy = undefined;
      await task.save();
      
      return reply.send({
        ok: true,
        data: {
          taskId: task._id.toString(),
          newStatus: task.status,
          message: 'Task queued for retry',
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Retry task error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Phase 5.3 - Parser Quality
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/system/quality
   * Get parser quality summary and metrics
   */
  app.get('/api/v4/admin/twitter/system/quality', async (req, reply) => {
    try {
      const { parserQualityService } = await import('../../twitter-user/services/parser-quality.service.js');
      
      const summary = await parserQualityService.getQualitySummary();
      const degraded = await parserQualityService.getDegradedTargets();
      
      return reply.send({
        ok: true,
        data: {
          summary: {
            total: summary.total,
            healthy: summary.healthy,
            degraded: summary.degraded,
            unstable: summary.unstable,
            avgScore: summary.avgScore,
            healthRate: summary.total > 0 
              ? Math.round((summary.healthy / summary.total) * 100) 
              : 100,
          },
          degradedTargets: degraded.slice(0, 20).map((m: any) => ({
            targetId: m.targetId.toString(),
            status: m.qualityStatus,
            score: m.qualityScore,
            emptyStreak: m.emptyStreak,
            successRate: m.runsTotal > 0 
              ? Math.round((m.runsWithResults / m.runsTotal) * 100) 
              : 0,
            degradedSince: m.degradedSince,
            reason: m.degradationReason,
          })),
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get quality error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/system/quality/:targetId
   * Get quality metrics for specific target
   */
  app.get('/api/v4/admin/twitter/system/quality/:targetId', async (req, reply) => {
    try {
      const { targetId } = req.params as { targetId: string };
      const { parserQualityService } = await import('../../twitter-user/services/parser-quality.service.js');
      
      const metrics = await parserQualityService.getMetrics(targetId);
      
      if (!metrics) {
        return reply.code(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: 'No quality metrics found for this target',
        });
      }
      
      const assessment = parserQualityService.assessQuality(metrics as any);
      const interpretation = parserQualityService.interpretEmptyResult(metrics as any);
      
      return reply.send({
        ok: true,
        data: {
          targetId,
          status: metrics.qualityStatus,
          score: metrics.qualityScore,
          runs: {
            total: metrics.runsTotal,
            withResults: metrics.runsWithResults,
            empty: metrics.runsEmpty,
            successRate: metrics.runsTotal > 0 
              ? Math.round((metrics.runsWithResults / metrics.runsTotal) * 100) 
              : 0,
          },
          fetch: {
            total: metrics.totalFetched,
            avg: Math.round(metrics.avgFetched * 10) / 10,
            max: metrics.maxFetched,
            min: metrics.minFetched === Infinity ? 0 : metrics.minFetched,
          },
          streak: {
            current: metrics.emptyStreak,
            max: metrics.maxEmptyStreak,
            lastNonEmpty: metrics.lastNonEmptyAt,
          },
          assessment: {
            reasons: assessment.reasons,
            recommendations: assessment.recommendations,
          },
          interpretation: {
            severity: interpretation.severity,
            message: interpretation.interpretation,
          },
          timestamps: {
            firstRun: metrics.firstRunAt,
            lastRun: metrics.lastRunAt,
            degradedSince: metrics.degradedSince,
          },
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get target quality error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}

