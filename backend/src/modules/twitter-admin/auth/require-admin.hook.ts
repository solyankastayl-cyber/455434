/**
 * A.3.0 - Admin Gate: requireAdmin middleware
 * 
 * ENV-based admin check: ADMIN_USER_IDS=dev-user,admin-1,admin-2
 * Any /api/v4/admin/* endpoint requires this middleware
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

// Parse admin user IDs from environment
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || 'dev-user')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

console.log('[AdminGate] Configured admin users:', ADMIN_USER_IDS);

/**
 * Check if a user ID is an admin
 */
export function isAdmin(userId: string): boolean {
  return ADMIN_USER_IDS.includes(userId);
}

/**
 * Get current user from request with admin flag
 */
export function getAdminUser(req: FastifyRequest): { id: string; isAdmin: boolean } | null {
  // Use existing auth mechanism
  const userId = (req as any).userId || 
                 (req.headers['x-user-id'] as string) || 
                 'dev-user'; // Fallback for dev
  
  return {
    id: userId,
    isAdmin: isAdmin(userId),
  };
}

/**
 * Require admin middleware
 * Returns 403 if user is not an admin
 */
export function requireAdmin(
  req: FastifyRequest, 
  reply: FastifyReply, 
  done: (err?: Error) => void
) {
  const user = getAdminUser(req);
  
  if (!user) {
    reply.code(401).send({
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
    return;
  }
  
  if (!user.isAdmin) {
    console.log(`[AdminGate] Access denied for user: ${user.id}`);
    reply.code(403).send({
      ok: false,
      error: 'ADMIN_ONLY',
      message: 'Administrator access required',
    });
    return;
  }
  
  // Attach admin user to request
  (req as any).adminUser = user;
  done();
}

/**
 * Get admin user from request (after requireAdmin middleware)
 */
export function getRequestAdmin(req: FastifyRequest): { id: string; isAdmin: boolean } {
  return (req as any).adminUser || { id: 'unknown', isAdmin: false };
}
