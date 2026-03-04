/**
 * BTC CASCADE VALIDATION ROUTES — D2.1 + P3.3
 * 
 * API endpoint for OOS validation.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { runBtcOosValidation, runBtcOosValidationAsOf } from './btc_validation.service.js';

export async function registerBtcValidationRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/forward/btc/admin';
  
  /**
   * POST /api/forward/btc/admin/validate/cascade
   * 
   * Run OOS validation comparing baseline BTC vs BTC cascade.
   * 
   * Body:
   * {
   *   "from": "2021-01-01",
   *   "to": "2025-12-31",
   *   "focus": "30d"
   * }
   */
  fastify.post(`${prefix}/validate/cascade`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      from?: string;
      to?: string;
      focus?: string;
    };
    
    const from = body.from || '2021-01-01';
    const to = body.to || '2025-12-31';
    const focus = body.focus || '30d';
    
    try {
      const result = await runBtcOosValidation(from, to, focus);
      return result;
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/forward/btc/admin/validate/cascade/asof
   * 
   * P3.3: Run HONEST AS-OF validation - no future data leakage.
   */
  fastify.post(`${prefix}/validate/cascade/asof`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      from?: string;
      to?: string;
      focus?: string;
    };
    
    const from = body.from || '2021-01-01';
    const to = body.to || '2025-12-31';
    const focus = body.focus || '30d';
    
    try {
      const result = await runBtcOosValidationAsOf(from, to, focus);
      return result;
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/forward/btc/admin/validate/cascade/quick
   * 
   * Quick validation with default params.
   */
  fastify.get(`${prefix}/validate/cascade/quick`, async () => {
    try {
      const result = await runBtcOosValidation('2021-01-01', '2025-12-31', '30d');
      
      // Return summary only
      return {
        ok: result.ok,
        period: result.period,
        summary: {
          baseline: {
            equity: result.baseline.equityFinal.toFixed(4),
            maxDD: (result.baseline.maxDrawdown * 100).toFixed(2) + '%',
            hitRate: (result.baseline.hitRate * 100).toFixed(1) + '%',
          },
          cascade: {
            equity: result.cascade.equityFinal.toFixed(4),
            maxDD: (result.cascade.maxDrawdown * 100).toFixed(2) + '%',
            hitRate: (result.cascade.hitRate * 100).toFixed(1) + '%',
          },
          delta: {
            equityDiff: result.delta.equityDiffPct.toFixed(2) + '%',
            maxDDDiff: result.delta.maxDDDiffPct.toFixed(2) + '%',
            volDiff: result.delta.volDiffPct.toFixed(2) + '%',
          },
        },
        acceptance: result.acceptance,
        durationMs: result.durationMs,
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });
  
  fastify.log.info(`[BTC Validation] Routes registered at ${prefix}/validate/cascade`);
}

export default registerBtcValidationRoutes;
