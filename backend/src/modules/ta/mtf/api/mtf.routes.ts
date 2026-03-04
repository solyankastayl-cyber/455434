/**
 * Phase M: MTF API Routes
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Db } from 'mongodb';
import { runMTF, initMTFIndexes, getLatestMTFDecision, getMTFDecisionByRunId, listMTFRuns } from '../mtf_runner.js';
import { MTFConfig, DEFAULT_MTF_CONFIG } from '../mtf_types.js';
import { getTFHierarchy } from '../tf_map.js';

export interface MTFRouteDeps {
  db: Db;
  decisionService: (args: { asset: string; timeframe: string }) => Promise<any>;
}

// Config store (in-memory)
let mtfConfig: MTFConfig = { ...DEFAULT_MTF_CONFIG };

export async function registerMTFRoutes(
  app: FastifyInstance,
  deps: MTFRouteDeps
): Promise<void> {
  const { db, decisionService } = deps;

  // Initialize indexes
  initMTFIndexes(db).catch(console.error);

  // ═══════════════════════════════════════════════════════════════
  // Status & Config
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/ta/mtf/status
   * Get MTF module status
   */
  app.get('/mtf/status', async () => {
    return {
      ok: true,
      phase: 'M',
      description: 'Multi-Timeframe — 1D/4H/1H aggregation',
      config: mtfConfig,
      timeframeHierarchy: getTFHierarchy(),
    };
  });

  /**
   * GET /api/ta/mtf/config
   * Get MTF config
   */
  app.get('/mtf/config', async () => {
    return {
      ok: true,
      config: mtfConfig,
    };
  });

  /**
   * PATCH /api/ta/mtf/config
   * Update MTF config
   */
  app.patch('/mtf/config', async (request: FastifyRequest<{
    Body: Partial<MTFConfig>
  }>) => {
    const patch = request.body || {};
    mtfConfig = { ...mtfConfig, ...patch };

    return {
      ok: true,
      config: mtfConfig,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // Decision Endpoints
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/ta/mtf/decision
   * Run MTF analysis and get decision
   */
  app.get('/mtf/decision', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset = 'BTCUSDT' } = request.query;

    try {
      const mtf = await runMTF({
        db,
        decisionService,
        cfg: mtfConfig,
        asset,
      });

      return {
        ok: true,
        ...mtf,
      };
    } catch (err: any) {
      console.error('[MTF] Decision error:', err);
      return {
        ok: false,
        error: err.message,
        asset,
      };
    }
  });

  /**
   * POST /api/ta/mtf/decision
   * Run MTF analysis with custom config
   */
  app.post('/mtf/decision', async (request: FastifyRequest<{
    Body: { asset: string; config?: Partial<MTFConfig> }
  }>) => {
    const { asset, config: configOverride } = request.body || {};

    if (!asset) {
      return { ok: false, error: 'asset is required' };
    }

    const cfg = { ...mtfConfig, ...configOverride };

    try {
      const mtf = await runMTF({
        db,
        decisionService,
        cfg,
        asset,
      });

      return {
        ok: true,
        ...mtf,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
        asset,
      };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Audit Endpoints
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/ta/mtf/audit/latest
   * Get latest MTF decision
   */
  app.get('/mtf/audit/latest', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset = 'BTCUSDT' } = request.query;

    const doc = await getLatestMTFDecision(db, asset);

    if (!doc) {
      return { ok: false, error: 'NO_MTF_DECISIONS', asset };
    }

    return {
      ok: true,
      mtfRunId: doc.mtfRunId,
      createdAt: doc.createdAt,
      decision: doc.decision,
    };
  });

  /**
   * GET /api/ta/mtf/audit/run/:id
   * Get MTF decision by run ID
   */
  app.get('/mtf/audit/run/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>) => {
    const { id } = request.params;

    const doc = await getMTFDecisionByRunId(db, id);

    if (!doc) {
      return { ok: false, error: 'NOT_FOUND', mtfRunId: id };
    }

    return {
      ok: true,
      decision: doc.decision,
      createdAt: doc.createdAt,
    };
  });

  /**
   * GET /api/ta/mtf/audit/runs
   * List recent MTF runs
   */
  app.get('/mtf/audit/runs', async (request: FastifyRequest<{
    Querystring: { asset?: string; limit?: string }
  }>) => {
    const { asset = 'BTCUSDT', limit = '20' } = request.query;

    const runs = await listMTFRuns(db, asset, parseInt(limit, 10));

    return {
      ok: true,
      asset,
      count: runs.length,
      runs: runs.map(r => ({
        mtfRunId: r.mtfRunId,
        createdAt: r.createdAt,
        biasRunId: r.biasRunId,
        setupRunId: r.setupRunId,
        triggerRunId: r.triggerRunId,
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // Summary Endpoint
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/ta/mtf/summary
   * Quick MTF summary without full run
   */
  app.get('/mtf/summary', async (request: FastifyRequest<{
    Querystring: { asset?: string }
  }>) => {
    const { asset = 'BTCUSDT' } = request.query;

    const doc = await getLatestMTFDecision(db, asset);

    if (!doc) {
      return { ok: false, error: 'NO_MTF_DECISIONS', asset };
    }

    const decision = doc.decision;
    const top = decision.scenarios[0];

    return {
      ok: true,
      asset,
      mtfRunId: doc.mtfRunId,
      createdAt: doc.createdAt,
      summary: {
        topBias: decision.topBias,
        topProbability: top?.probability || 0,
        topConfidence: top?.confidence || 'LOW',
        topDirection: top?.direction || 'NEUTRAL',
        scenariosCount: decision.scenarios.length,
        penalties: top?.penalties || [],
      },
      topScenario: top ? {
        id: top.id,
        direction: top.direction,
        probability: (top.probability * 100).toFixed(1) + '%',
        intent: top.intent,
        confidence: top.confidence,
        bias: top.bias,
        setup: top.setup,
        trigger: top.trigger,
      } : null,
    };
  });
}
