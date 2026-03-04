/**
 * SPX ATTRIBUTION — Routes
 * 
 * BLOCK B6.2 — API endpoints for attribution
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SpxAttributionService } from './spx-attribution.service.js';
import type { SpxAttributionQuery } from './spx-attribution.types.js';

export async function registerSpxAttributionRoutes(fastify: FastifyInstance) {
  const service = new SpxAttributionService();
  
  const prefix = '/api/spx/v2.1/admin/attribution';

  /**
   * GET /api/spx/v2.1/admin/attribution
   * 
   * Main attribution endpoint (aggregated)
   * 
   * Query params:
   * - window: 30d | 90d | 365d | all
   * - source: LIVE | VINTAGE | ALL
   * - cohort: LIVE | V1950 | V1990 | V2008 | V2020 | ALL
   * - preset: CONSERVATIVE | BALANCED | AGGRESSIVE
   */
  fastify.get(prefix, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as SpxAttributionQuery;
    
    try {
      const result = await service.getAttribution(query);
      return reply.send(result);
    } catch (error: any) {
      fastify.log.error(`[SPX Attribution] Error: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/attribution/summary
   * 
   * Just KPIs (lightweight)
   */
  fastify.get(`${prefix}/summary`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as SpxAttributionQuery;
    
    try {
      const result = await service.getAttribution(query);
      return reply.send({
        ok: true,
        kpis: result.kpis,
        counts: result.counts,
      });
    } catch (error: any) {
      return reply.code(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/attribution/tier
   * 
   * Tier breakdown only
   */
  fastify.get(`${prefix}/tier`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as SpxAttributionQuery;
    
    try {
      const result = await service.getAttribution(query);
      return reply.send({
        ok: true,
        breakdown: result.breakdowns.tier,
      });
    } catch (error: any) {
      return reply.code(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/attribution/phase
   * 
   * Phase breakdown only
   */
  fastify.get(`${prefix}/phase`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as SpxAttributionQuery;
    
    try {
      const result = await service.getAttribution(query);
      return reply.send({
        ok: true,
        breakdown: result.breakdowns.phase,
      });
    } catch (error: any) {
      return reply.code(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/attribution/insights
   * 
   * Insights only
   */
  fastify.get(`${prefix}/insights`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as SpxAttributionQuery;
    
    try {
      const result = await service.getAttribution(query);
      return reply.send({
        ok: true,
        insights: result.insights,
      });
    } catch (error: any) {
      return reply.code(500).send({ ok: false, error: error.message });
    }
  });

  fastify.log.info(`[SPX Attribution] Routes registered at ${prefix}/* (BLOCK B6.2 READY)`);
}

export default registerSpxAttributionRoutes;
