/**
 * SPX CASCADE VALIDATION ROUTES — D1.1 + P3.3
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { runSpxOosValidation, runSpxOosValidationAsOf } from './spx_validation.service.js';

export async function registerSpxValidationRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/forward/spx/admin';
  
  fastify.post(`${prefix}/validate/cascade`, async (req: FastifyRequest) => {
    const body = (req.body ?? {}) as { from?: string; to?: string; focus?: string };
    const from = body.from || '2021-01-01';
    const to = body.to || '2025-12-31';
    const focus = body.focus || '30d';
    
    try {
      return await runSpxOosValidation(from, to, focus);
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });
  
  // P3.3: Honest As-Of validation
  fastify.post(`${prefix}/validate/cascade/asof`, async (req: FastifyRequest) => {
    const body = (req.body ?? {}) as { from?: string; to?: string; focus?: string };
    const from = body.from || '2021-01-01';
    const to = body.to || '2025-12-31';
    const focus = body.focus || '30d';
    
    try {
      return await runSpxOosValidationAsOf(from, to, focus);
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });
  
  fastify.get(`${prefix}/validate/cascade/quick`, async () => {
    try {
      const result = await runSpxOosValidation('2021-01-01', '2025-12-31', '30d');
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
  
  fastify.log.info(`[SPX Validation] Routes registered at ${prefix}/validate/cascade`);
}

export default registerSpxValidationRoutes;
