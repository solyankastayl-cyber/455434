// Auth hook for extracting user from request
import type { FastifyRequest } from 'fastify';

export interface AuthUser {
  id: string;
  isAdmin?: boolean;
}

export function requireUser(req: FastifyRequest): AuthUser {
  // EXPECTED: req.user injected by your auth plugin
  const u = (req as any).user;
  
  if (!u?.id) {
    // Dev fallback (REMOVE in production)
    console.log('[Auth] Using dev user fallback');
    return { id: 'dev-user', isAdmin: true };
  }
  
  return { id: String(u.id), isAdmin: !!u.isAdmin };
}
