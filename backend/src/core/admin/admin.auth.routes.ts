/**
 * Admin Auth Routes
 * 
 * Authentication endpoints:
 * - POST /admin/auth/login
 * - GET /admin/auth/status
 * - GET /admin/auth/users (list admins)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  ensureAdminSeed, 
  loginAdmin, 
  listAdminUsers,
  createAdminUser,
  changePassword,
} from './admin.auth.service.js';
import { requireAdminAuth } from './admin.middleware.js';
import { logAdminAction } from './admin.audit.js';
import { AdminUserModel } from './admin.models.js';
import type { AdminLoginRequest, AdminRole } from './admin.types.js';

export async function adminAuthRoutes(app: FastifyInstance): Promise<void> {
  // Initialize admin seed on startup
  await ensureAdminSeed();

  /**
   * POST /admin/auth/login
   * Public endpoint - no auth required
   */
  app.post('/auth/login', async (
    request: FastifyRequest<{ Body: AdminLoginRequest }>,
    reply: FastifyReply
  ) => {
    const { username, password } = request.body || {} as any;
    
    if (!username || !password) {
      return reply.code(400).send({ 
        ok: false, 
        error: 'BAD_REQUEST',
        message: 'Username and password required',
      });
    }

    const result = await loginAdmin(username, password);
    
    if (!result) {
      // Log failed login
      await logAdminAction({
        adminId: 'unknown',
        adminUsername: username,
        action: 'LOGIN_FAILED',
        result: 'failure',
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      
      return reply.code(401).send({ 
        ok: false, 
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }

    // Log successful login
    await logAdminAction({
      adminId: result.userId,
      adminUsername: username,
      action: 'LOGIN_SUCCESS',
      result: 'success',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.send({
      ok: true,
      token: result.token,
      role: result.role,
      username: result.username,
      issuedAtTs: result.iat,
      expiresAtTs: result.exp,
    });
  });

  /**
   * GET /admin/auth/status
   * Check current admin session
   */
  app.get('/auth/status', {
    preHandler: requireAdminAuth(['ADMIN', 'MODERATOR']),
  }, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const admin = request.admin!;
    
    return reply.send({
      ok: true,
      data: {
        role: admin.role,
        userId: admin.sub,
        issuedAtTs: admin.iat,
        expiresAtTs: admin.exp,
        expiresIn: admin.exp - Math.floor(Date.now() / 1000),
      },
    });
  });

  /**
   * GET /admin/auth/users
   * List all admin users (ADMIN only)
   */
  app.get('/auth/users', {
    preHandler: requireAdminAuth(['ADMIN']),
  }, async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const users = await listAdminUsers();
    
    return reply.send({
      ok: true,
      data: { users },
    });
  });

  /**
   * POST /admin/auth/users
   * Create new admin user (ADMIN only)
   */
  app.post('/auth/users', {
    preHandler: requireAdminAuth(['ADMIN']),
  }, async (
    request: FastifyRequest<{ Body: { username: string; password: string; role: AdminRole } }>,
    reply: FastifyReply
  ) => {
    const { username, password, role } = request.body || {} as any;
    
    if (!username || !password || !role) {
      return reply.code(400).send({
        ok: false,
        error: 'BAD_REQUEST',
        message: 'username, password, and role required',
      });
    }

    if (!['ADMIN', 'MODERATOR'].includes(role)) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_ROLE',
        message: 'Role must be ADMIN or MODERATOR',
      });
    }

    const success = await createAdminUser(username, password, role);
    
    if (!success) {
      return reply.code(409).send({
        ok: false,
        error: 'USER_EXISTS',
        message: 'Username already exists',
      });
    }

    return reply.send({
      ok: true,
      message: `Admin user ${username} created with role ${role}`,
    });
  });

  /**
   * POST /admin/auth/change-password
   * Change own password
   */
  app.post('/auth/change-password', {
    preHandler: requireAdminAuth(['ADMIN', 'MODERATOR']),
  }, async (
    request: FastifyRequest<{ Body: { currentPassword: string; newPassword: string } }>,
    reply: FastifyReply
  ) => {
    const { currentPassword, newPassword } = request.body || {} as any;
    
    if (!currentPassword) {
      return reply.code(400).send({
        ok: false,
        error: 'BAD_REQUEST',
        message: 'Current password is required',
      });
    }
    
    if (!newPassword || newPassword.length < 8) {
      return reply.code(400).send({
        ok: false,
        error: 'BAD_REQUEST',
        message: 'New password must be at least 8 characters',
      });
    }

    // Get current user info
    const admin = request.admin!;
    
    // Verify current password first
    const user = await AdminUserModel.findById(admin.sub).lean();
    if (!user) {
      return reply.code(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'Admin user not found',
      });
    }
    
    // Verify current password
    const loginResult = await loginAdmin(user.username, currentPassword);
    if (!loginResult) {
      await logAdminAction(admin.sub, 'PASSWORD_CHANGE', 'failure', 'profile', request);
      return reply.code(401).send({
        ok: false,
        error: 'INVALID_PASSWORD',
        message: 'Current password is incorrect',
      });
    }
    
    // Change password
    const success = await changePassword(user.username, newPassword);
    
    if (success) {
      await logAdminAction(admin.sub, 'PASSWORD_CHANGE', 'success', 'profile', request);
      return reply.send({
        ok: true,
        message: 'Password changed successfully',
      });
    }
    
    return reply.code(500).send({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to change password',
    });
  });

  app.log.info('[Admin] Auth routes registered');
}

export default adminAuthRoutes;
