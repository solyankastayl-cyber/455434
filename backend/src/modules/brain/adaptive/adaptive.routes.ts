/**
 * P12 — Adaptive Coefficient Learning Routes
 * 
 * GET  /api/brain/v2/adaptive/params     — Get current params
 * GET  /api/brain/v2/adaptive/schema     — Schema documentation
 * POST /api/brain/v2/adaptive/run        — Start tuning run
 * GET  /api/brain/v2/adaptive/status     — Get run status/report
 * GET  /api/brain/v2/adaptive/history    — Get params history
 * POST /api/brain/v2/adaptive/promote    — Promote params to active
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getAdaptiveService } from './adaptive.service.js';
import { 
  createDefaultParams, 
  DEFAULT_BRAIN_PARAMS,
  DEFAULT_OPTIMIZER_PARAMS,
  DEFAULT_METARISK_PARAMS,
  DEFAULT_GATES,
  validateAdaptiveParams,
  AssetId,
} from './adaptive.contract.js';

export async function adaptiveRoutes(fastify: FastifyInstance): Promise<void> {

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/adaptive/params
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/adaptive/params', async (
    request: FastifyRequest<{
      Querystring: { asset?: string }
    }>,
    reply: FastifyReply
  ) => {
    const asset = (request.query.asset || 'dxy') as AssetId;
    
    try {
      const service = getAdaptiveService();
      const params = await service.getParams(asset);
      
      const validation = validateAdaptiveParams(params);
      
      return reply.send({
        ok: true,
        params,
        validation: {
          valid: validation.valid,
          errors: validation.errors.length > 0 ? validation.errors : undefined,
        },
      });
    } catch (e) {
      console.error('[Adaptive] Get params error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'ADAPTIVE_PARAMS_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/adaptive/schema
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/adaptive/schema', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      version: 'P12',
      description: 'Adaptive Coefficient Learning - walk-forward tuning',
      philosophy: [
        'NOT ML blackbox — rolling recalibration of weights',
        'Grid search with smoothing (alpha=0.35)',
        'Strict acceptance gates',
        'Never touch: guard dominance, shrink logic, TAIL risk-down',
      ],
      
      parameterGroups: {
        brain_rules: {
          description: 'Brain Quantile thresholds',
          defaults: DEFAULT_BRAIN_PARAMS,
          tunable: false, // Too sensitive for auto-tuning
        },
        optimizer: {
          description: 'Optimizer coefficients',
          defaults: DEFAULT_OPTIMIZER_PARAMS,
          tunable: true,
          tunableFields: ['K', 'wReturn', 'wTail', 'wCorr', 'wGuard'],
        },
        metarisk: {
          description: 'MetaRisk mapping coefficients',
          defaults: DEFAULT_METARISK_PARAMS,
          tunable: true,
          tunableFields: ['durationScale', 'stabilityScale', 'flipPenalty', 'crossAdj'],
        },
      },
      
      gates: {
        description: 'Acceptance gates for promotion',
        defaults: DEFAULT_GATES,
        checks: [
          'avgDeltaHitRatePp >= 2',
          'minDeltaPp >= -1',
          'flipRatePerYear <= 6',
          'maxOverrideIntensity <= cap (0.35 BASE, 0.60 TAIL)',
          'determinism = true',
          'noLookahead = true',
        ],
      },
      
      tuningAlgorithm: {
        method: 'walk-forward grid search',
        gridSize: '3x3 (0.9x, 1.0x, 1.1x)',
        smoothing: 'new = 0.35*candidate + 0.65*current',
        objective: 'score = avgDeltaHitRatePp - penalties',
        penalties: [
          'degradation: -2 if minDelta < -1pp',
          'flipStorm: -0.5 * (flipRate - 6) if > 6',
          'overrideExplosion: -10 * (intensity - 0.35) if > 0.35',
          'instability: -2 * (0.5 - stability) if < 0.5',
        ],
      },
      
      endpoints: {
        params: 'GET /api/brain/v2/adaptive/params?asset=dxy',
        run: 'POST /api/brain/v2/adaptive/run',
        status: 'GET /api/brain/v2/adaptive/status?id=...',
        history: 'GET /api/brain/v2/adaptive/history?asset=dxy',
        promote: 'POST /api/brain/v2/adaptive/promote',
      },
    });
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/brain/v2/adaptive/run
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/brain/v2/adaptive/run', async (
    request: FastifyRequest<{
      Body: {
        asset?: string;
        start?: string;
        end?: string;
        steps?: number;
        mode?: string;
        gridSize?: number;
      }
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const now = new Date();
    
    const runRequest = {
      asset: (body.asset || 'dxy') as AssetId,
      start: body.start || '2024-01-01',
      end: body.end || now.toISOString().split('T')[0],
      steps: body.steps || 35,
      mode: (body.mode || 'shadow') as 'off' | 'shadow' | 'on',
      gridSize: body.gridSize || 3,
    };
    
    try {
      const service = getAdaptiveService();
      const runId = await service.runTuning(runRequest);
      
      return reply.send({
        ok: true,
        runId,
        status: 'started',
        message: 'Tuning run started. Poll /api/brain/v2/adaptive/status?id=... for results.',
        params: runRequest,
      });
    } catch (e) {
      console.error('[Adaptive] Run error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'ADAPTIVE_RUN_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/brain/v2/adaptive/run/fast — Two-Phase Optimized
  // Phase A: Quick Filter (5 steps, 8 candidates)
  // Phase B: Deep Validation (full steps, top 3 only)
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/brain/v2/adaptive/run/fast', async (
    request: FastifyRequest<{
      Body: {
        asset?: string;
        start?: string;
        end?: string;
        steps?: number;
        mode?: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const now = new Date();
    
    const runRequest = {
      asset: (body.asset || 'dxy') as AssetId,
      start: body.start || '2024-01-01',
      end: body.end || now.toISOString().split('T')[0],
      steps: body.steps || 35,
      mode: (body.mode || 'shadow') as 'off' | 'shadow' | 'on',
    };
    
    try {
      const service = getAdaptiveService();
      const runId = await service.runTwoPhase(runRequest);
      
      return reply.send({
        ok: true,
        runId,
        status: 'started',
        type: 'two-phase',
        message: 'Two-phase tuning started. Phase A: Quick Filter (5 steps, 8 candidates), Phase B: Deep Validation (full steps, top 3).',
        estimatedTime: '~40 minutes (vs ~5 hours for full grid)',
        params: runRequest,
      });
    } catch (e) {
      console.error('[Adaptive] Fast run error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'ADAPTIVE_RUN_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/adaptive/status
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/adaptive/status', async (
    request: FastifyRequest<{
      Querystring: { id?: string }
    }>,
    reply: FastifyReply
  ) => {
    const runId = request.query.id;
    if (!runId) {
      return reply.status(400).send({
        ok: false,
        error: 'Missing id parameter',
      });
    }
    
    try {
      const service = getAdaptiveService();
      const status = await service.getRunStatus(runId);
      return reply.send(status);
    } catch (e) {
      console.error('[Adaptive] Status error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'ADAPTIVE_STATUS_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/adaptive/history
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/adaptive/history', async (
    request: FastifyRequest<{
      Querystring: { asset?: string; limit?: string }
    }>,
    reply: FastifyReply
  ) => {
    const asset = (request.query.asset || 'dxy') as AssetId;
    const limit = parseInt(request.query.limit || '10');
    
    try {
      const service = getAdaptiveService();
      const history = await service.getHistory(asset, limit);
      
      return reply.send({
        ok: true,
        asset,
        count: history.length,
        history,
      });
    } catch (e) {
      console.error('[Adaptive] History error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'ADAPTIVE_HISTORY_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/brain/v2/adaptive/promote
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/brain/v2/adaptive/promote', async (
    request: FastifyRequest<{
      Body: {
        asset?: string;
        versionId?: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const asset = (body.asset || 'dxy') as AssetId;
    const versionId = body.versionId;
    
    if (!versionId) {
      return reply.status(400).send({
        ok: false,
        error: 'Missing versionId parameter',
      });
    }
    
    try {
      const service = getAdaptiveService();
      await service.promote(asset, versionId);
      
      // Get new active params
      const newParams = await service.getParams(asset);
      
      return reply.send({
        ok: true,
        promoted: versionId,
        asset,
        newActiveParams: newParams,
      });
    } catch (e) {
      console.error('[Adaptive] Promote error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'ADAPTIVE_PROMOTE_ERROR',
        message: (e as Error).message,
      });
    }
  });

  console.log('[Adaptive] P12 Routes registered at /api/brain/v2/adaptive/*');
}
