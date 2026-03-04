/**
 * SPX CRISIS ROUTES
 * 
 * BLOCK B6.10 — Crisis Validation API
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spxCrisisService } from './spx-crisis.service.js';
import { SPX_CRISIS_EPOCHS } from './spx-crisis.registry.js';

interface QueryParams {
  preset?: string;
}

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerSpxCrisisRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/spx/v2.1/admin';

  /**
   * GET /api/spx/v2.1/admin/crisis/epochs
   * 
   * Returns list of crisis epochs registry
   */
  app.get(`${prefix}/crisis/epochs`, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      data: {
        epochs: SPX_CRISIS_EPOCHS,
        count: SPX_CRISIS_EPOCHS.length,
      },
    });
  });

  /**
   * GET /api/spx/v2.1/admin/crisis/matrix
   * 
   * Returns full crisis skill matrix
   * Query: preset=BALANCED
   */
  app.get(`${prefix}/crisis/matrix`, async (
    request: FastifyRequest<{ Querystring: QueryParams }>,
    reply: FastifyReply
  ) => {
    try {
      const preset = request.query.preset ?? 'BALANCED';
      const matrix = await spxCrisisService.buildCrisisSkillMatrix(preset);
      
      return reply.send({
        ok: true,
        data: matrix,
        meta: {
          totalEpochs: matrix.totalEpochs,
          totalCells: matrix.totalCells,
          globalVerdict: matrix.globalVerdict,
        },
      });
    } catch (err: any) {
      console.error('[SPX Crisis] Matrix error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Failed to build crisis matrix',
      });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/crisis/guardrails
   * 
   * Returns crisis-aware guardrails policy
   */
  app.get(`${prefix}/crisis/guardrails`, async (
    request: FastifyRequest<{ Querystring: QueryParams }>,
    reply: FastifyReply
  ) => {
    try {
      const preset = request.query.preset ?? 'BALANCED';
      const policy = await spxCrisisService.buildCrisisGuardrailsPolicy(preset);
      
      return reply.send({
        ok: true,
        data: policy,
        meta: {
          version: policy.version,
          summary: policy.summary,
        },
      });
    } catch (err: any) {
      console.error('[SPX Crisis] Guardrails error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Failed to build crisis guardrails',
      });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/crisis/summary
   * 
   * Returns quick summary of crisis validation
   */
  app.get(`${prefix}/crisis/summary`, async (
    request: FastifyRequest<{ Querystring: QueryParams }>,
    reply: FastifyReply
  ) => {
    try {
      const preset = request.query.preset ?? 'BALANCED';
      const matrix = await spxCrisisService.buildCrisisSkillMatrix(preset);
      
      return reply.send({
        ok: true,
        data: {
          globalVerdict: matrix.globalVerdict,
          epochSummary: matrix.epochSummary.map(e => ({
            epoch: e.epoch,
            label: e.label,
            verdict: e.verdict,
            stabilityScore: e.stabilityScore,
            edgeSurvived: e.edgeSurvived,
            samples: e.totalSamples,
          })),
          recommendations: matrix.recommendations,
        },
      });
    } catch (err: any) {
      console.error('[SPX Crisis] Summary error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Failed to build crisis summary',
      });
    }
  });

  console.log('[SPX Crisis] B6.10 Routes registered at', prefix + '/crisis/*');
}

/**
 * Debug endpoint to check crisis↔outcomes binding
 */
export async function registerSpxCrisisDebugRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/spx/v2.1/admin';

  /**
   * GET /api/spx/v2.1/admin/crisis/debug-samples
   * 
   * Returns sample outcomes for a specific epoch to verify filtering
   * Query: epoch=GFC_2008&horizon=90d&limit=10
   */
  app.get(`${prefix}/crisis/debug-samples`, async (
    request: FastifyRequest<{ 
      Querystring: { 
        epoch?: string; 
        horizon?: string; 
        limit?: string;
        preset?: string;
      } 
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { epoch = 'GFC_2008', horizon = '90d', limit = '10', preset = 'BALANCED' } = request.query;
      
      // Find epoch
      const epochConfig = SPX_CRISIS_EPOCHS.find(e => e.code === epoch);
      if (!epochConfig) {
        return reply.status(400).send({
          ok: false,
          error: `Unknown epoch: ${epoch}. Valid: ${SPX_CRISIS_EPOCHS.map(e => e.code).join(', ')}`,
        });
      }

      // Import model dynamically to avoid circular deps
      const { SpxOutcomeModel } = await import('../spx-memory/spx-outcome.model.js');
      
      // Query outcomes
      const samples = await SpxOutcomeModel.find({
        preset,
        symbol: 'SPX',
        asOfDate: { $gte: epochConfig.start, $lte: epochConfig.end },
        horizon,
      })
        .sort({ asOfDate: 1 })
        .limit(parseInt(limit))
        .lean();

      // Count total
      const total = await SpxOutcomeModel.countDocuments({
        preset,
        symbol: 'SPX',
        asOfDate: { $gte: epochConfig.start, $lte: epochConfig.end },
        horizon,
      });

      return reply.send({
        ok: true,
        data: {
          epoch: epochConfig,
          horizon,
          preset,
          total,
          samples: samples.map(s => ({
            asOfDate: s.asOfDate,
            resolvedDate: s.resolvedDate,
            horizon: s.horizon,
            hit: s.hit,
            expectedDirection: s.expectedDirection,
            actualReturnPct: s.actualReturnPct,
            realizedDirection: s.actualReturnPct > 0.1 ? 'UP' : s.actualReturnPct < -0.1 ? 'DOWN' : 'NEUTRAL',
          })),
        },
      });
    } catch (err: any) {
      console.error('[SPX Crisis] Debug error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Debug query failed',
      });
    }
  });

  console.log('[SPX Crisis] Debug endpoint registered at', prefix + '/crisis/debug-samples');
}

export default registerSpxCrisisRoutes;
