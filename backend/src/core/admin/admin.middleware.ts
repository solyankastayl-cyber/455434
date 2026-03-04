/**
 * Admin Middleware
 * 
 * Authentication middleware for admin routes.
 * Validates JWT and checks role permissions.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAdminToken } from './admin.auth.service.js';
import type { AdminRole, AdminTokenPayload } from './admin.types.js';

// Extend FastifyRequest to include admin payload
declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminTokenPayload;
  }
}

/**
 * Require admin authentication
 * @param allowedRoles - Roles that can access this route
 */
export function requireAdminAuth(allowedRoles: AdminRole[] = ['ADMIN']) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const auth = request.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    
    if (!token) {
      return reply.code(401).send({ 
        ok: false, 
        error: 'ADMIN_AUTH_REQUIRED',
        message: 'Admin authentication required',
      });
    }

    const decoded = verifyAdminToken(token);
    
    if (!decoded) {
      return reply.code(401).send({ 
        ok: false, 
        error: 'ADMIN_AUTH_INVALID',
        message: 'Invalid or expired admin token',
      });
    }

    if (!allowedRoles.includes(decoded.role)) {
      return reply.code(403).send({ 
        ok: false, 
        error: 'ADMIN_FORBIDDEN',
        message: `Requires one of roles: ${allowedRoles.join(', ')}`,
      });
    }

    // Attach admin payload to request
    request.admin = decoded;
  };
}

/**
 * Optional admin auth - doesn't fail if not authenticated
 */
export function optionalAdminAuth() {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    const auth = request.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    
    if (token) {
      const decoded = verifyAdminToken(token);
      if (decoded) {
        request.admin = decoded;
      }
    }
  };
}

export default {
  requireAdminAuth,
  optionalAdminAuth,
};
