/**
 * P10.2 — MetaRisk Routes
 * 
 * GET  /api/brain/v2/meta-risk          — Get current MetaRisk
 * GET  /api/brain/v2/meta-risk/schema   — Schema documentation
 * GET  /api/brain/v2/meta-risk/timeline — Historical MetaRisk
 * POST /api/brain/v2/meta-risk/simulate — Simulate with overrides
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getMetaRiskService } from '../services/meta_risk.service.js';
import { 
  validateMetaRiskPack, 
  META_RISK_BOUNDS,
  POSTURE_THRESHOLDS,
  BASE_CAPS,
} from '../contracts/meta_risk.contract.js';

export async function metaRiskRoutes(fastify: FastifyInstance): Promise<void> {

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/meta-risk
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/meta-risk', async (
    request: FastifyRequest<{
      Querystring: { asOf?: string }
    }>,
    reply: FastifyReply
  ) => {
    const asOf = request.query.asOf;
    
    try {
      const service = getMetaRiskService();
      const pack = await service.getMetaRisk(asOf);
      
      const validation = validateMetaRiskPack(pack);
      
      return reply.send({ 
        ok: true, 
        ...pack,
        validation: {
          valid: validation.valid,
          errors: validation.errors.length > 0 ? validation.errors : undefined,
        },
      });
    } catch (e) {
      console.error('[MetaRisk] Error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'META_RISK_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/meta-risk/schema
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/meta-risk/schema', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      version: 'P10.2',
      description: 'MetaRisk Scale: duration + stability → posture + caps',
      
      output: {
        metaRiskScale: {
          range: [META_RISK_BOUNDS.SCALE_MIN, META_RISK_BOUNDS.SCALE_MAX],
          default: 1.0,
          description: 'Aggression multiplier for allocations',
        },
        posture: {
          values: ['DEFENSIVE', 'NEUTRAL', 'OFFENSIVE'],
          thresholds: {
            OFFENSIVE: `metaRiskScale >= ${POSTURE_THRESHOLDS.OFFENSIVE_MIN}`,
            DEFENSIVE: `metaRiskScale <= ${POSTURE_THRESHOLDS.DEFENSIVE_MAX} OR guardLevel in [BLOCK,CRISIS] OR scenario=TAIL`,
            NEUTRAL: 'otherwise',
          },
        },
        maxOverrideCap: {
          range: [META_RISK_BOUNDS.CAP_MIN, META_RISK_BOUNDS.CAP_MAX],
          baseCaps: BASE_CAPS,
          description: 'Maximum override intensity Brain can apply',
        },
      },
      
      components: {
        durationBoost: {
          range: [-0.10, +0.08],
          formula: {
            EASING: '+0.08 * sat((days-30)/90)',
            NEUTRAL: '+0.03 * sat((days-45)/120)',
            TIGHTENING: '-0.06 * sat((days-14)/60)',
            STRESS: '-0.10 * sat((days-7)/30)',
          },
        },
        stabilityBoost: {
          range: [0, +0.05],
          formula: '+0.05 * sat((stability-0.65)/0.25)',
        },
        flipPenalty: {
          range: [-0.10, 0],
          formula: '-0.10 * sat(flips30d/6)',
        },
        guardDrag: {
          values: { BLOCK: -0.40, CRISIS: -0.25, WARN: -0.10, NONE: 0 },
        },
        crossAssetAdj: {
          values: { 
            RISK_ON_SYNC: +0.03, 
            MIXED: 0, 
            DECOUPLED: -0.05,
            FLIGHT_TO_QUALITY: -0.10,
            RISK_OFF_SYNC: -0.08,
          },
        },
        scenarioAdj: {
          values: { TAIL: -0.25, RISK: -0.12, BASE: +0.02 },
        },
      },
      
      formula: 'metaRiskScale = clamp(1.0 + Σcomponents, 0.60, 1.10)',
      
      endpoints: {
        current: 'GET /api/brain/v2/meta-risk?asOf=YYYY-MM-DD',
        timeline: 'GET /api/brain/v2/meta-risk/timeline?start=&end=&stepDays=',
        simulate: 'POST /api/brain/v2/meta-risk/simulate { overrides }',
      },
    });
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/meta-risk/timeline
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/meta-risk/timeline', async (
    request: FastifyRequest<{
      Querystring: { 
        start?: string; 
        end?: string; 
        stepDays?: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    const now = new Date();
    const defaultEnd = now.toISOString().split('T')[0];
    const defaultStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const start = request.query.start || defaultStart;
    const end = request.query.end || defaultEnd;
    const stepDays = parseInt(request.query.stepDays || '7');

    try {
      const service = getMetaRiskService();
      const timeline = await service.getTimeline(start, end, stepDays);
      
      return reply.send({ ok: true, ...timeline });
    } catch (e) {
      console.error('[MetaRisk] Timeline error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'TIMELINE_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/brain/v2/meta-risk/simulate
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/brain/v2/meta-risk/simulate', async (
    request: FastifyRequest<{
      Body: {
        asOf?: string;
        overrides?: {
          macroRegime?: string;
          guardLevel?: string;
          crossAssetRegime?: string;
          scenario?: string;
          flips30d?: number;
        };
      }
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const asOf = body.asOf || new Date().toISOString().split('T')[0];
    const overrides = body.overrides || {};

    try {
      const service = getMetaRiskService();
      const pack = await service.getMetaRiskWithOverrides(asOf, overrides);
      
      return reply.send({ 
        ok: true, 
        simulated: true,
        overridesApplied: overrides,
        ...pack,
      });
    } catch (e) {
      console.error('[MetaRisk] Simulate error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'SIMULATE_ERROR',
        message: (e as Error).message,
      });
    }
  });

  console.log('[MetaRisk] P10.2 Routes registered at /api/brain/v2/meta-risk/*');
}
