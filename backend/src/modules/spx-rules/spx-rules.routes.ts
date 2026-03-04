/**
 * SPX RULES — Routes
 * 
 * BLOCK B6.6 — Rule Extraction API
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spxRulesService } from './spx-rules.service.js';
import type { SkillMetric } from './spx-rules.types.js';

interface RulesQuery {
  metric?: string;
}

interface EpochQuery {
  metric?: string;
}

export function registerSpxRulesRoutes(app: FastifyInstance): void {
  const prefix = '/api/spx/v2.1/admin/rules';

  /**
   * GET /api/spx/v2.1/admin/rules/extract
   * 
   * Extract rules with skill scores
   * 
   * Query params:
   * - metric: skillTotal | skillUp | skillDown (default: skillTotal)
   */
  app.get(`${prefix}/extract`, async (
    request: FastifyRequest<{ Querystring: RulesQuery }>,
    reply: FastifyReply
  ) => {
    try {
      const metricParam = request.query.metric ?? 'skillTotal';
      const validMetrics: SkillMetric[] = ['skillTotal', 'skillUp', 'skillDown'];
      
      if (!validMetrics.includes(metricParam as SkillMetric)) {
        return reply.status(400).send({ 
          ok: false, 
          error: `Invalid metric. Use: ${validMetrics.join(', ')}` 
        });
      }

      const result = await spxRulesService.extract(metricParam as SkillMetric);
      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      console.error('[SPX Rules] Extract error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/rules/epoch-matrix
   * 
   * Get epoch matrix for heatmap visualization
   */
  app.get(`${prefix}/epoch-matrix`, async (
    request: FastifyRequest<{ Querystring: EpochQuery }>,
    reply: FastifyReply
  ) => {
    try {
      const metricParam = request.query.metric ?? 'skillTotal';
      const validMetrics: SkillMetric[] = ['skillTotal', 'skillUp', 'skillDown'];
      
      if (!validMetrics.includes(metricParam as SkillMetric)) {
        return reply.status(400).send({ 
          ok: false, 
          error: `Invalid metric. Use: ${validMetrics.join(', ')}` 
        });
      }

      const result = await spxRulesService.getEpochMatrix(metricParam as SkillMetric);
      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      console.error('[SPX Rules] Epoch matrix error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  console.log('[SPX Rules] Routes registered at', prefix);
}

export default registerSpxRulesRoutes;
