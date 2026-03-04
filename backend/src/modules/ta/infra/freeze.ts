/**
 * Phase S1: Freeze Guard Middleware
 * Blocks write operations when freeze is enabled
 */

import { FastifyRequest, FastifyReply, FastifyPluginCallback } from 'fastify';
import { isFrozen, isAllowedDuringFreeze } from './config.js';

/**
 * Freeze guard middleware
 */
export async function freezeGuard(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!isFrozen()) return;
  
  const method = request.method;
  const path = request.url.split('?')[0];
  
  // Check whitelist
  if (isAllowedDuringFreeze(method, path)) return;
  
  // Block non-whitelisted requests during freeze
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    reply.status(503).send({
      ok: false,
      error: 'SERVICE_FROZEN',
      message: 'TA module is in freeze mode. Write operations are disabled.',
      freezeEnabled: true,
    });
    return;
  }
}

/**
 * Register freeze guard as Fastify plugin
 */
export const freezeGuardPlugin: FastifyPluginCallback = (fastify, opts, done) => {
  fastify.addHook('preHandler', freezeGuard);
  done();
};

/**
 * Check if request is a write operation
 */
export function isWriteOperation(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}
