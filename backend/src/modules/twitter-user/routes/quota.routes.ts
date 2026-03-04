/**
 * Quota API Routes
 */

import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/require-user.hook.js';
import { TwitterQuotaService } from '../services/quota.service.js';

export async function registerQuotaRoutes(app: FastifyInstance) {
  const quotaService = new TwitterQuotaService();

  /**
   * GET /api/v4/twitter/quota
   * Get current quota status
   */
  app.get('/api/v4/twitter/quota', async (req, reply) => {
    try {
      const u = requireUser(req);
      const status = await quotaService.getStatus(u.id);
      
      return reply.send({
        ok: true,
        data: status,
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/quota/recalculate
   * Force recalculation of quota (admin/dev)
   */
  app.post('/api/v4/twitter/quota/recalculate', async (req, reply) => {
    try {
      const u = requireUser(req);
      const quota = await quotaService.recalculate(u.id);
      
      return reply.send({
        ok: true,
        data: {
          accounts: quota.accountsLinked,
          hardCapPerHour: quota.hardCapPerHour,
          hardCapPerDay: quota.hardCapPerDay,
        },
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
