/**
 * Learning Control Routes (Phase 12C)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './learning_control.service.js';
import { z } from 'zod';
import { ADAPTIVE_VERSION } from '../../config/env.js';

const FreezeBody = z.object({
  reason: z.string(),
  by: z.string().optional(),
});

const UnfreezeBody = z.object({
  by: z.string().optional(),
});

export async function learningControlRoutes(app: FastifyInstance): Promise<void> {
  // Add version header
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Adaptive-Version', ADAPTIVE_VERSION);
  });
  
  /**
   * GET /api/learning/status
   * Get learning control status
   */
  app.get('/status', async () => {
    const stats = await service.getLearningControlStats();
    return { ok: true, data: stats };
  });
  
  /**
   * GET /api/learning/health
   * Check system health and drift
   */
  app.get('/health', async () => {
    const [healthScore, driftCheck] = await Promise.all([
      service.calculateHealthScore(),
      service.checkDriftGuard(),
    ]);
    
    return {
      ok: true,
      data: {
        healthScore,
        ...driftCheck,
      },
    };
  });
  
  /**
   * GET /api/learning/rate
   * Get effective learning rate
   */
  app.get('/rate', async () => {
    const rate = await service.getEffectiveLearningRate();
    return { ok: true, data: { effectiveLearningRate: rate } };
  });
  
  /**
   * POST /api/learning/freeze
   * Freeze all learning
   */
  app.post('/freeze', async (request: FastifyRequest) => {
    const body = FreezeBody.parse(request.body);
    const control = await service.freezeLearning(body.reason, body.by);
    return { ok: true, data: control, message: 'Learning frozen' };
  });
  
  /**
   * POST /api/learning/unfreeze
   * Resume learning
   */
  app.post('/unfreeze', async (request: FastifyRequest) => {
    const body = UnfreezeBody.parse(request.body);
    const control = await service.unfreezeLearning(body.by);
    return { ok: true, data: control, message: 'Learning resumed' };
  });
  
  /**
   * POST /api/learning/reset
   * Reset all adaptive weights to base values
   */
  app.post('/reset', async () => {
    const result = await service.resetAdaptiveWeights();
    return { ok: true, data: result, message: 'Weights reset to base values' };
  });
  
  /**
   * GET /api/learning/legacy-stats
   * Get legacy Python access statistics
   */
  app.get('/legacy-stats', async () => {
    const stats = await service.getLegacyAccessStats();
    return { ok: true, data: stats };
  });
  
  app.log.info('Learning Control routes registered');
}
