/**
 * A.3 - Admin Twitter Routes
 * 
 * All routes require admin authentication
 * 
 * A.3.1 - Overview & Users List
 * A.3.2 - User Detail & Actions
 * A.3.3 - Policies Engine
 */

import type { FastifyInstance } from 'fastify';
import { requireAdmin, getRequestAdmin } from '../auth/require-admin.hook.js';
import { AdminUsersService, AdminUserHealth } from '../services/admin-users.service.js';
import { AdminUserDetailService } from '../services/admin-user-detail.service.js';
import { AdminActionsService } from '../services/admin-actions.service.js';
import { registerPolicyRoutes } from './policy.routes.js';
import { registerSystemRoutes } from './system.routes.js';
import { registerLoadTestRoutes } from './load-test.routes.js';
import { registerConsentPolicyRoutes } from './consent-policy.routes.js';

export async function registerAdminTwitterRoutes(app: FastifyInstance) {
  console.log('[BOOT] Starting registerAdminTwitterRoutes');
  const usersService = new AdminUsersService();
  const detailService = new AdminUserDetailService();
  const actionsService = new AdminActionsService();
  
  // Apply admin auth to all routes in this plugin
  app.addHook('preHandler', requireAdmin);
  
  // Register Policy routes (A.3.3)
  console.log('[BOOT] About to register policy routes');
  try {
    await registerPolicyRoutes(app);
    console.log('[BOOT] Policy routes registered successfully');
  } catch (err) {
    console.error('[BOOT] Failed to register policy routes:', err);
  }
  
  // Register System Health routes (A.3.4)
  console.log('[BOOT] About to register system health routes');
  try {
    await registerSystemRoutes(app);
    console.log('[BOOT] System health routes registered successfully');
  } catch (err) {
    console.error('[BOOT] Failed to register system health routes:', err);
  }
  
  // Register Load Test routes (Stage D)
  console.log('[BOOT] About to register load test routes');
  try {
    await registerLoadTestRoutes(app);
    console.log('[BOOT] Load test routes registered successfully');
  } catch (err) {
    console.error('[BOOT] Failed to register load test routes:', err);
  }
  
  // Register Consent Policy routes (Data Usage Policies)
  console.log('[BOOT] About to register consent policy routes');
  try {
    await registerConsentPolicyRoutes(app);
    console.log('[BOOT] Consent policy routes registered successfully');
  } catch (err) {
    console.error('[BOOT] Failed to register consent policy routes:', err);
  }
  
  // ============================================
  // A.3.1 - Overview & Users List
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/overview
   * System totals and health summary
   */
  app.get('/api/v4/admin/twitter/overview', async (req, reply) => {
    try {
      const overview = await usersService.getOverview();
      return reply.send({ ok: true, data: overview });
    } catch (err: any) {
      app.log.error(err, 'Admin overview error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/users
   * Paginated users list with aggregated data
   * 
   * Query params:
   * - page: number (default 1)
   * - limit: number (default 25, max 100)
   * - status: HEALTHY | WARNING | DEGRADED | BLOCKED
   * - search: string (userId search)
   * - sortBy: risk | lastParse | sessions
   * - sortOrder: asc | desc
   */
  app.get('/api/v4/admin/twitter/users', async (req, reply) => {
    try {
      const query = req.query as {
        page?: string;
        limit?: string;
        status?: string;
        search?: string;
        sortBy?: string;
        sortOrder?: string;
      };
      
      const options = {
        page: query.page ? parseInt(query.page, 10) : 1,
        limit: Math.min(query.limit ? parseInt(query.limit, 10) : 25, 100),
        status: query.status as AdminUserHealth | undefined,
        search: query.search,
        sortBy: (query.sortBy || 'lastParse') as 'risk' | 'lastParse' | 'sessions',
        sortOrder: (query.sortOrder || 'desc') as 'asc' | 'desc',
      };
      
      const result = await usersService.getUsers(options);
      return reply.send({ ok: true, data: result });
    } catch (err: any) {
      app.log.error(err, 'Admin users list error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // A.3.2 - User Detail
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/users/:userId
   * Detailed user information
   */
  app.get('/api/v4/admin/twitter/users/:userId', async (req, reply) => {
    try {
      const { userId } = req.params as { userId: string };
      const detail = await detailService.getUserDetail(userId);
      
      if (!detail) {
        return reply.code(404).send({ 
          ok: false, 
          error: 'USER_NOT_FOUND',
          message: 'User not found or has no accounts',
        });
      }
      
      return reply.send({ ok: true, data: detail });
    } catch (err: any) {
      app.log.error(err, 'Admin user detail error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/users/:userId/tasks
   * Recent parse tasks for a user
   */
  app.get('/api/v4/admin/twitter/users/:userId/tasks', async (req, reply) => {
    try {
      const { userId } = req.params as { userId: string };
      const query = req.query as { limit?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      
      const tasks = await detailService.getUserTasks(userId, limit);
      return reply.send({ ok: true, data: tasks });
    } catch (err: any) {
      app.log.error(err, 'Admin user tasks error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/users/:userId/actions
   * Action history for a user (audit log)
   */
  app.get('/api/v4/admin/twitter/users/:userId/actions', async (req, reply) => {
    try {
      const { userId } = req.params as { userId: string };
      const query = req.query as { limit?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      
      const actions = await actionsService.getUserActionHistory(userId, limit);
      return reply.send({ ok: true, data: actions });
    } catch (err: any) {
      app.log.error(err, 'Admin user actions error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // A.3.2 - Admin Actions
  // ============================================
  
  /**
   * POST /api/v4/admin/twitter/users/:userId/disable
   * Disable parsing for a user
   */
  app.post('/api/v4/admin/twitter/users/:userId/disable', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const { userId } = req.params as { userId: string };
      const body = (req.body || {}) as { reason?: string };
      
      const result = await actionsService.disableUserParsing(admin.id, userId, body.reason);
      
      return reply.send({ ok: result.success, ...result });
    } catch (err: any) {
      app.log.error(err, 'Admin disable user error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/users/:userId/enable
   * Enable parsing for a user
   */
  app.post('/api/v4/admin/twitter/users/:userId/enable', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const { userId } = req.params as { userId: string };
      
      const result = await actionsService.enableUserParsing(admin.id, userId);
      
      return reply.send({ ok: result.success, ...result });
    } catch (err: any) {
      app.log.error(err, 'Admin enable user error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/users/:userId/cooldown
   * Force cooldown for all user sessions
   */
  app.post('/api/v4/admin/twitter/users/:userId/cooldown', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const { userId } = req.params as { userId: string };
      const body = (req.body || {}) as { reason?: string };
      
      const result = await actionsService.forceUserCooldown(admin.id, userId, body.reason);
      
      return reply.send({ ok: result.success, ...result });
    } catch (err: any) {
      app.log.error(err, 'Admin cooldown error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/users/:userId/invalidate-sessions
   * Invalidate all sessions for a user
   */
  app.post('/api/v4/admin/twitter/users/:userId/invalidate-sessions', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const { userId } = req.params as { userId: string };
      const body = (req.body || {}) as { reason?: string };
      
      const result = await actionsService.invalidateAllSessions(admin.id, userId, body.reason);
      
      return reply.send({ ok: result.success, ...result });
    } catch (err: any) {
      app.log.error(err, 'Admin invalidate sessions error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/sessions/:sessionId/invalidate
   * Invalidate a specific session
   */
  app.post('/api/v4/admin/twitter/sessions/:sessionId/invalidate', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const { sessionId } = req.params as { sessionId: string };
      const body = (req.body || {}) as { reason?: string };
      
      const result = await actionsService.invalidateSession(admin.id, sessionId, body.reason);
      
      if (!result.success) {
        return reply.code(404).send({ ok: false, error: 'SESSION_NOT_FOUND', message: result.message });
      }
      
      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      app.log.error(err, 'Admin invalidate session error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/accounts/:accountId/disable
   * Disable a specific account
   */
  app.post('/api/v4/admin/twitter/accounts/:accountId/disable', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const { accountId } = req.params as { accountId: string };
      const body = (req.body || {}) as { reason?: string };
      
      const result = await actionsService.disableAccount(admin.id, accountId, body.reason);
      
      if (!result.success) {
        return reply.code(404).send({ ok: false, error: 'ACCOUNT_NOT_FOUND', message: result.message });
      }
      
      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      app.log.error(err, 'Admin disable account error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/accounts/:accountId/enable
   * Enable a specific account
   */
  app.post('/api/v4/admin/twitter/accounts/:accountId/enable', async (req, reply) => {
    try {
      const admin = getRequestAdmin(req);
      const { accountId } = req.params as { accountId: string };
      
      const result = await actionsService.enableAccount(admin.id, accountId);
      
      if (!result.success) {
        return reply.code(404).send({ ok: false, error: 'ACCOUNT_NOT_FOUND', message: result.message });
      }
      
      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      app.log.error(err, 'Admin enable account error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
