/**
 * User Tiers Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './user_tiers.service.js';
import * as repo from './user_tiers.repository.js';
import { UpdateUserTierBody, UserIdParams } from './tiers.schema.js';

function getUserId(request: FastifyRequest): string {
  return (request.headers['x-user-id'] as string) || 'anonymous';
}

export async function tiersRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/tiers/me
   * Get current user's tier info
   */
  app.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const info = await service.getUserTierInfo(userId);
    
    return { ok: true, data: info };
  });
  
  /**
   * GET /api/tiers/limits
   * Check current limits status
   */
  app.get('/limits', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    
    const [followCheck, ruleCheck, signalsUsage] = await Promise.all([
      service.canCreateFollow(userId),
      service.canCreateAlertRule(userId),
      repo.getSignalsUsage(userId),
    ]);
    
    const info = await service.getUserTierInfo(userId);
    
    return {
      ok: true,
      data: {
        tier: info.tier,
        follows: {
          used: followCheck.current || 0,
          limit: followCheck.limit || 0,
          canCreate: followCheck.allowed,
        },
        alertRules: {
          used: ruleCheck.current || 0,
          limit: ruleCheck.limit || 0,
          canCreate: ruleCheck.allowed,
        },
        signals: {
          used: signalsUsage.used,
          limit: signalsUsage.limit,
        },
        apiRateLimit: info.limits.apiRateLimit,
        signalDelay: info.limits.signalDelay,
        historicalDepth: info.limits.historicalDepthDays,
      },
    };
  });
  
  /**
   * PUT /api/tiers/:userId
   * Update user tier (admin only - no auth check for now)
   */
  app.put('/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = UserIdParams.parse(request.params);
    const body = UpdateUserTierBody.parse(request.body);
    
    const tier = await service.setUserTier(params.userId, body.tier);
    
    if (!tier) {
      return reply.status(404).send({ ok: false, error: 'User not found' });
    }
    
    return { ok: true, data: tier };
  });
  
  /**
   * GET /api/tiers/stats
   * Get tier statistics (admin)
   */
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = await repo.getTierStats();
    return { ok: true, data: stats };
  });
}
