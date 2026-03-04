/**
 * SPX GUARDRAILS — Routes
 * 
 * BLOCK B6.7 — Institutional Anti-Harm Guardrails API
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spxGuardrailsService } from './spx-guardrails.service.js';

interface GuardrailQuery {
  preset?: string;
}

interface HorizonParams {
  horizon: string;
}

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerSpxGuardrailsRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/spx/v2.1';

  /**
   * GET /api/spx/v2.1/guardrails
   * 
   * Get full guardrail policy for all horizons
   * 
   * Query params:
   * - preset: BALANCED | CONSERVATIVE | AGGRESSIVE
   */
  app.get(`${prefix}/guardrails`, async (
    request: FastifyRequest<{ Querystring: GuardrailQuery }>,
    reply: FastifyReply
  ) => {
    try {
      const preset = request.query.preset ?? 'BALANCED';
      const policy = await spxGuardrailsService.buildPolicy(preset);
      
      return reply.send({
        ok: true,
        data: policy,
        meta: {
          version: policy.version,
          policyHash: policy.policyHash,
          globalStatus: policy.globalStatus,
          allowedCount: policy.allowedHorizons.length,
          blockedCount: policy.blockedHorizons.length,
          cautionCount: policy.cautionHorizons.length,
        },
      });
    } catch (err: any) {
      console.error('[SPX Guardrails] Policy error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Failed to build guardrail policy',
      });
    }
  });

  /**
   * GET /api/spx/v2.1/guardrails/:horizon
   * 
   * Get guardrail decision for specific horizon
   */
  app.get(`${prefix}/guardrails/:horizon`, async (
    request: FastifyRequest<{ Params: HorizonParams; Querystring: GuardrailQuery }>,
    reply: FastifyReply
  ) => {
    try {
      const { horizon } = request.params;
      const preset = request.query.preset ?? 'BALANCED';
      
      const validHorizons = ['7d', '14d', '30d', '90d', '180d', '365d'];
      if (!validHorizons.includes(horizon)) {
        return reply.status(400).send({
          ok: false,
          error: `Invalid horizon. Use: ${validHorizons.join(', ')}`,
        });
      }
      
      const decision = await spxGuardrailsService.getHorizonGuardrail(horizon, preset);
      
      if (!decision) {
        return reply.status(404).send({
          ok: false,
          error: `No guardrail decision for horizon ${horizon}`,
        });
      }
      
      return reply.send({
        ok: true,
        data: decision,
      });
    } catch (err: any) {
      console.error('[SPX Guardrails] Horizon error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Failed to get horizon guardrail',
      });
    }
  });

  /**
   * GET /api/spx/v2.1/guardrails/summary
   * 
   * Get quick summary of guardrail status
   */
  app.get(`${prefix}/guardrails/summary`, async (
    request: FastifyRequest<{ Querystring: GuardrailQuery }>,
    reply: FastifyReply
  ) => {
    try {
      const preset = request.query.preset ?? 'BALANCED';
      const policy = await spxGuardrailsService.buildPolicy(preset);
      
      return reply.send({
        ok: true,
        data: {
          globalStatus: policy.globalStatus,
          version: policy.version,
          policyHash: policy.policyHash,
          allowed: policy.allowedHorizons,
          blocked: policy.blockedHorizons,
          caution: policy.cautionHorizons,
          edgeUnlocked: policy.allowedHorizons.length > 0 
            ? policy.allowedHorizons.join(', ') 
            : 'NONE',
          rulesMode: 'ON',
        },
      });
    } catch (err: any) {
      console.error('[SPX Guardrails] Summary error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Failed to get guardrail summary',
      });
    }
  });

  console.log('[SPX Guardrails] Routes registered at', prefix);
}

export default registerSpxGuardrailsRoutes;
