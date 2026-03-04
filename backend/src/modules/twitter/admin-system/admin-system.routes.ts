// Admin System Parsing Routes
// All routes require admin authentication and work with SYSTEM scope only

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getSystemAccounts,
  getSystemAccountById,
  createSystemAccount,
  updateSystemAccount,
  disableSystemAccount,
  getAccountSessionStats,
  getSystemSessions,
  getSystemSessionById,
  testSystemSession,
  invalidateSystemSession,
  getSystemTasks,
  runSystemParse,
  abortSystemTask,
  getSystemHealth,
  CreateSystemAccountInput,
  RunSystemParseInput,
} from './admin-system.service.js';

// Admin check middleware (simplified - integrate with your auth system)
async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  // TODO: Integrate with actual admin auth
  // For now, allow all requests in dev mode
  const isAdmin = true; // Replace with real check
  if (!isAdmin) {
    return reply.status(403).send({ ok: false, error: 'Admin access required' });
  }
}

export async function registerAdminSystemRoutes(app: FastifyInstance): Promise<void> {
  // Apply admin check to all routes
  app.addHook('preHandler', requireAdmin);

  // ==================== ACCOUNTS ====================

  // GET /api/v4/admin/system/accounts
  app.get('/accounts', async (_request, reply) => {
    try {
      const accounts = await getSystemAccounts();
      
      // Enrich with session stats
      const enriched = await Promise.all(
        accounts.map(async (acc) => ({
          ...acc,
          sessions: await getAccountSessionStats(acc._id.toString()),
        }))
      );
      
      return reply.send({ ok: true, data: enriched });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // GET /api/v4/admin/system/accounts/:id
  app.get('/accounts/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const account = await getSystemAccountById(id);
      
      if (!account) {
        return reply.status(404).send({ ok: false, error: 'Account not found' });
      }
      
      const sessions = await getAccountSessionStats(id);
      return reply.send({ ok: true, data: { ...account, sessions } });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /api/v4/admin/system/accounts
  app.post('/accounts', async (request, reply) => {
    try {
      const input = request.body as CreateSystemAccountInput;
      
      if (!input.username) {
        return reply.status(400).send({ ok: false, error: 'username is required' });
      }
      
      const account = await createSystemAccount(input);
      return reply.status(201).send({ ok: true, data: account });
    } catch (error: any) {
      if (error.code === 11000) {
        return reply.status(409).send({ ok: false, error: 'Account already exists' });
      }
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // PUT /api/v4/admin/system/accounts/:id
  app.put('/accounts/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const updates = request.body as { label?: string; tags?: string[]; status?: string };
      
      const account = await updateSystemAccount(id, updates);
      
      if (!account) {
        return reply.status(404).send({ ok: false, error: 'Account not found' });
      }
      
      return reply.send({ ok: true, data: account });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /api/v4/admin/system/accounts/:id/disable
  app.post('/accounts/:id/disable', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const success = await disableSystemAccount(id);
      
      if (!success) {
        return reply.status(404).send({ ok: false, error: 'Account not found' });
      }
      
      return reply.send({ ok: true, message: 'Account disabled' });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // ==================== SESSIONS ====================

  // GET /api/v4/admin/system/sessions
  app.get('/sessions', async (_request, reply) => {
    try {
      const sessions = await getSystemSessions();
      return reply.send({ ok: true, data: sessions });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // GET /api/v4/admin/system/sessions/:sessionId
  app.get('/sessions/:sessionId', async (request, reply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };
      const session = await getSystemSessionById(sessionId);
      
      if (!session) {
        return reply.status(404).send({ ok: false, error: 'Session not found' });
      }
      
      return reply.send({ ok: true, data: session });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /api/v4/admin/system/sessions/test
  app.post('/sessions/test', async (request, reply) => {
    try {
      const { sessionId } = request.body as { sessionId: string };
      
      if (!sessionId) {
        return reply.status(400).send({ ok: false, error: 'sessionId is required' });
      }
      
      const result = await testSystemSession(sessionId);
      return reply.send({ ok: true, data: result });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /api/v4/admin/system/sessions/invalidate
  app.post('/sessions/invalidate', async (request, reply) => {
    try {
      const { sessionId } = request.body as { sessionId: string };
      
      if (!sessionId) {
        return reply.status(400).send({ ok: false, error: 'sessionId is required' });
      }
      
      const success = await invalidateSystemSession(sessionId);
      
      if (!success) {
        return reply.status(404).send({ ok: false, error: 'Session not found or not SYSTEM scope' });
      }
      
      return reply.send({ ok: true, message: 'Session invalidated' });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // ==================== TASKS ====================

  // GET /api/v4/admin/system/tasks
  app.get('/tasks', async (request, reply) => {
    try {
      const { limit } = request.query as { limit?: string };
      const tasks = await getSystemTasks(limit ? parseInt(limit) : 50);
      return reply.send({ ok: true, data: tasks });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /api/v4/admin/system/tasks/run
  app.post('/tasks/run', async (request, reply) => {
    try {
      const input = request.body as RunSystemParseInput;
      
      if (!input.sessionId || !input.target) {
        return reply.status(400).send({ ok: false, error: 'sessionId and target are required' });
      }
      
      if (!input.type) {
        // Default to SEARCH if target doesn't start with @
        input.type = input.target.startsWith('@') ? 'ACCOUNT_TWEETS' : 'SEARCH';
      }
      
      const result = await runSystemParse(input);
      
      // If blocked by preflight, return 412 Precondition Failed
      if (result.blocked) {
        return reply.status(412).send({
          ok: false,
          blocked: true,
          error: result.error,
          blockers: result.blockers,
        });
      }
      
      if (!result.ok) {
        return reply.status(400).send(result);
      }
      
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /api/v4/admin/system/tasks/:taskId/abort
  app.post('/tasks/:taskId/abort', async (request, reply) => {
    try {
      const { taskId } = request.params as { taskId: string };
      const success = await abortSystemTask(taskId);
      
      if (!success) {
        return reply.status(404).send({ ok: false, error: 'Task not found or not running' });
      }
      
      return reply.send({ ok: true, message: 'Task aborted' });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // ==================== HEALTH ====================

  // GET /api/v4/admin/system/health
  app.get('/health', async (_request, reply) => {
    try {
      const health = await getSystemHealth();
      return reply.send({ ok: true, data: health });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // GET /api/v4/admin/system/logs - Recent parse logs
  app.get('/logs', async (request, reply) => {
    try {
      const { limit, status } = request.query as { limit?: string; status?: string };
      const query: any = {};
      if (status) query.status = status;
      
      const { SystemParseLogModel } = await import('./system-parse-log.model.js');
      const logs = await SystemParseLogModel.find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit || '50'))
        .lean();
      
      return reply.send({ ok: true, data: logs });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // GET /api/v4/admin/system/stats - Abort rate and other stats
  app.get('/stats', async (_request, reply) => {
    try {
      const { SystemParseLogModel, SystemParseLogStatus } = await import('./system-parse-log.model.js');
      
      // Last 24 hours
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const logs = await SystemParseLogModel.find({ createdAt: { $gte: since } }).lean();
      
      const total = logs.length;
      const blocked = logs.filter(l => l.status === SystemParseLogStatus.BLOCKED).length;
      const aborted = logs.filter(l => l.status === SystemParseLogStatus.ABORTED).length;
      const done = logs.filter(l => l.status === SystemParseLogStatus.DONE).length;
      
      const abortRate = total > 0 ? Math.round(((blocked + aborted) / total) * 100) : 0;
      
      return reply.send({
        ok: true,
        data: {
          period: '24h',
          total,
          blocked,
          aborted,
          done,
          abortRate,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // ==================== SCHEDULER ====================

  // GET /api/v4/admin/system/scheduler/status
  app.get('/scheduler/status', async (_request, reply) => {
    try {
      const { systemScheduler } = await import('./system-scheduler.service.js');
      const status = await systemScheduler.getStatus();
      return reply.send({ ok: true, data: status });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /api/v4/admin/system/scheduler/tick - Manual tick trigger
  app.post('/scheduler/tick', async (_request, reply) => {
    try {
      const { systemScheduler } = await import('./system-scheduler.service.js');
      const result = await systemScheduler.tick();
      return reply.send({ ok: true, data: result });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /api/v4/admin/system/scheduler/start - Start scheduler
  app.post('/scheduler/start', async (_request, reply) => {
    try {
      const { systemScheduler } = await import('./system-scheduler.service.js');
      systemScheduler.start();
      const status = await systemScheduler.getStatus();
      return reply.send({ ok: true, message: 'Scheduler started', data: status });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /api/v4/admin/system/scheduler/stop - Stop scheduler
  app.post('/scheduler/stop', async (_request, reply) => {
    try {
      const { systemScheduler } = await import('./system-scheduler.service.js');
      systemScheduler.stop();
      const status = await systemScheduler.getStatus();
      return reply.send({ ok: true, message: 'Scheduler stopped', data: status });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  console.log('[AdminSystemRoutes] Registered at /api/v4/admin/system');
}
