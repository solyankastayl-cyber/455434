/**
 * Tier Enforcement Middleware
 * 
 * Fastify hooks for enforcing tier limits on API endpoints.
 * Can be attached to specific routes or globally.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  checkRateLimit,
  canCreateFollow,
  canCreateAlertRule,
} from './user_tiers.service.js';

/**
 * Get userId from request
 */
function getUserId(request: FastifyRequest): string {
  return (request.headers['x-user-id'] as string) || 'anonymous';
}

/**
 * Rate limit enforcement hook
 * Attach to routes that should be rate limited
 */
export async function rateLimitHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = getUserId(request);
  const result = await checkRateLimit(userId);
  
  if (!result.allowed) {
    reply.status(429).send({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: result.reason,
      limit: result.limit,
      current: result.current,
    });
    return;
  }
}

/**
 * Follow creation limit enforcement hook
 */
export async function followLimitHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = getUserId(request);
  const result = await canCreateFollow(userId);
  
  if (!result.allowed) {
    reply.status(403).send({
      ok: false,
      error: 'FOLLOW_LIMIT_REACHED',
      message: result.reason,
      limit: result.limit,
      current: result.current,
    });
    return;
  }
}

/**
 * Alert rule creation limit enforcement hook
 */
export async function alertRuleLimitHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = getUserId(request);
  const result = await canCreateAlertRule(userId);
  
  if (!result.allowed) {
    reply.status(403).send({
      ok: false,
      error: 'ALERT_RULE_LIMIT_REACHED',
      message: result.reason,
      limit: result.limit,
      current: result.current,
    });
    return;
  }
}

/**
 * Tier info header decorator
 * Adds tier info to response headers
 */
export async function tierInfoHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = getUserId(request);
  
  // Import here to avoid circular
  const { getUserTierInfo } = await import('./user_tiers.service.js');
  const info = await getUserTierInfo(userId);
  
  reply.header('X-User-Tier', info.tier);
  reply.header('X-Rate-Limit', info.limits.apiRateLimit.toString());
}
