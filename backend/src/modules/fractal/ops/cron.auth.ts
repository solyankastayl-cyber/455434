/**
 * FRACTAL OPS — Cron Authentication
 * 
 * Secures admin endpoints with Bearer token.
 * Required for production cron jobs.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Validate cron secret from Authorization header
 * @throws 401 if invalid
 */
export function requireCronAuth(req: FastifyRequest): void {
  const secret = process.env.FRACTAL_CRON_SECRET;
  
  if (!secret) {
    console.error('[CRON] FRACTAL_CRON_SECRET not configured');
    const err: any = new Error('Server misconfiguration');
    err.statusCode = 500;
    throw err;
  }

  const auth = String(req.headers.authorization ?? '');
  const ok = auth === `Bearer ${secret}`;
  
  if (!ok) {
    const err: any = new Error('Unauthorized: Invalid cron secret');
    err.statusCode = 401;
    throw err;
  }
}

/**
 * Fastify preHandler hook for cron auth
 */
export async function cronAuthHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    requireCronAuth(req);
  } catch (err: any) {
    reply.status(err.statusCode || 401).send({ error: err.message });
    throw err;
  }
}

/**
 * Check if request has valid cron auth (non-throwing)
 */
export function hasCronAuth(req: FastifyRequest): boolean {
  const secret = process.env.FRACTAL_CRON_SECRET;
  if (!secret) return false;
  
  const auth = String(req.headers.authorization ?? '');
  return auth === `Bearer ${secret}`;
}
