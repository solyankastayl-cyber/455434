/**
 * Engine Routes (Sprint 4 → v1.1 → v2)
 * 
 * API endpoints for Engine v1.1 + KPI + ML
 * 
 * v1.1 Changes:
 * - Stricter thresholds
 * - Penalty weights
 * - Conflict detection
 * - Better explainability
 * 
 * v2 Additions:
 * - KPI endpoints
 * - Feature extraction
 * - ML scoring (disabled by default)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildEngineInput, buildEngineInputForActor } from './engine_input.service.js';
import { generateDecision } from './engine_decision.service.js';
import { generateDecisionV1_1, ENGINE_CONFIG } from './engine_decision_v1_1.service.js';
import { EngineDecisionModel } from './engine_decision.model.js';
import { parseWindow, TimeWindow } from '../common/window.service.js';
import { buildEnvelope, buildErrorEnvelope } from '../common/analysis_envelope.js';
import {
  calculateFullKPI,
  calculateDistributionKPI,
  calculateCoverageKPI,
  calculateStabilityKPI,
  KPI_THRESHOLDS,
} from './engine_kpi.service.js';
import { extractFeatures, getFeatureNames } from './engine_feature_extractor.js';
import { calculateMLScoring, getMLConfig, setMLEnabled } from './engine_ml_scoring.js';
import { 
  runShadowComparison, 
  calculateShadowKPIs, 
  getShadowConfig, 
  setShadowEnabled,
  SHADOW_CONFIG 
} from './engine_shadow.service.js';
import {
  runHistoricalReplay,
  runPerturbationTest,
  runMonteCarloTest,
} from './engine_simulation.service.js';

// Feature flag for v1.1
const USE_ENGINE_V1_1 = true;

export async function engineRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/engine/input
   * Build engine input for asset/actor
   */
  app.get('/engine/input', async (request: FastifyRequest) => {
    const query = request.query as {
      asset?: string;
      actor?: string;
      window?: string;
    };
    
    const window = parseWindow(query.window, '24h');
    
    if (!query.asset && !query.actor) {
      return buildErrorEnvelope('Either asset or actor parameter required', window);
    }
    
    try {
      let input;
      
      if (query.actor) {
        input = await buildEngineInputForActor(query.actor, window);
      } else {
        input = await buildEngineInput(query.asset!, window);
      }
      
      return buildEnvelope(input, {
        interpretation: {
          headline: `Engine input prepared for ${input.asset.symbol}`,
          description: `Collected ${input.contexts.length} contexts, ${input.signals.length} signals, ${input.actors.length} actors`,
        },
        coverage: {
          pct: input.coverage.overall,
          note: `Contexts: ${input.coverage.contexts}%, Actors: ${input.coverage.actors}%, Signals: ${input.coverage.signals}%`,
        },
        window,
        checked: ['contexts', 'signals', 'actors', 'graph'],
      });
    } catch (err: any) {
      return buildErrorEnvelope(err.message, window);
    }
  });
  
  /**
   * POST /api/engine/decide
   * Generate decision for asset/actor
   */
  app.post('/engine/decide', async (request: FastifyRequest) => {
    const body = request.body as {
      asset?: string;
      actor?: string;
      window?: string;
    };
    
    const window = parseWindow(body.window, '24h');
    
    if (!body.asset && !body.actor) {
      return buildErrorEnvelope('Either asset or actor parameter required', window);
    }
    
    try {
      // Build input
      let input;
      if (body.actor) {
        input = await buildEngineInputForActor(body.actor, window);
      } else {
        input = await buildEngineInput(body.asset!, window);
      }
      
      // Generate decision (v1.1 or v1)
      const decision = USE_ENGINE_V1_1 
        ? await generateDecisionV1_1(input)
        : await generateDecision(input);
      
      // Run shadow comparison (v1.1 vs v2) - does not affect production decision
      if (SHADOW_CONFIG.enabled) {
        runShadowComparison(input, {
          id: decision.id,
          decision: decision.decision,
          confidenceBand: decision.confidenceBand,
          scores: decision.scores,
        }).catch(err => console.error('[Shadow] Error:', err));
      }
      
      return buildEnvelope(decision, {
        interpretation: {
          headline: `${decision.decision} signal based on ${decision.reasoning.primaryContext?.headline || 'observed patterns'}`,
          description: decision.reasoning.supportingFacts[0] || 'Multiple signals analyzed',
        },
        coverage: {
          pct: input.coverage.overall,
          note: `Based on ${input.actors.length} actors, ${input.signals.length} signals, ${input.contexts.length} contexts`,
        },
        window,
        checked: ['contexts', 'signals', 'actors', 'graph', 'coverage'],
      });
    } catch (err: any) {
      return buildErrorEnvelope(err.message, window);
    }
  });
  
  /**
   * GET /api/engine/decisions
   * Get decision history
   */
  app.get('/engine/decisions', async (request: FastifyRequest) => {
    const query = request.query as {
      asset?: string;
      decision?: string;
      limit?: string;
    };
    
    const filter: any = {};
    
    if (query.asset) {
      filter['asset.symbol'] = { $regex: query.asset, $options: 'i' };
    }
    
    if (query.decision) {
      filter.decision = query.decision.toUpperCase();
    }
    
    const limit = Math.min(parseInt(query.limit || '20'), 100);
    
    const decisions = await EngineDecisionModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    return {
      ok: true,
      data: {
        decisions: decisions.map((d: any) => ({
          id: d.decisionId,
          asset: d.asset,
          window: d.window,
          decision: d.decision,
          confidenceBand: d.confidenceBand,
          scores: d.scores,
          reasoning: d.reasoning,
          createdAt: d.createdAt,
          feedback: d.feedback?.helpful,
        })),
        count: decisions.length,
      },
    };
  });
  
  /**
   * GET /api/engine/decisions/:id
   * Get decision details
   */
  app.get('/engine/decisions/:id', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const decision = await EngineDecisionModel.findOne({ decisionId: id }).lean();
    
    if (!decision) {
      return {
        ok: false,
        error: 'DECISION_NOT_FOUND',
      };
    }
    
    const d = decision as any;
    
    return {
      ok: true,
      data: {
        id: d.decisionId,
        inputId: d.inputId,
        asset: d.asset,
        window: d.window,
        decision: d.decision,
        confidenceBand: d.confidenceBand,
        scores: d.scores,
        reasoning: d.reasoning,
        explainability: d.explainability,
        coverage: d.coverage,
        feedback: d.feedback,
        engineVersion: d.engineVersion,
        createdAt: d.createdAt,
      },
    };
  });
  
  /**
   * POST /api/engine/decisions/:id/feedback
   * Submit feedback on decision (P4)
   */
  app.post('/engine/decisions/:id/feedback', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      helpful: boolean;
      comment?: string;
    };
    
    const decision = await EngineDecisionModel.findOneAndUpdate(
      { decisionId: id },
      {
        $set: {
          'feedback.helpful': body.helpful,
          'feedback.feedbackAt': new Date(),
          'feedback.comment': body.comment || null,
        },
      },
      { new: true }
    ).lean();
    
    if (!decision) {
      return {
        ok: false,
        error: 'DECISION_NOT_FOUND',
      };
    }
    
    return {
      ok: true,
      data: { recorded: true },
    };
  });
  
  /**
   * GET /api/engine/stats
   * Get engine statistics
   */
  app.get('/engine/stats', async () => {
    const [
      totalDecisions,
      byDecision,
      byConfidence,
      recentBuys,
      feedbackStats,
    ] = await Promise.all([
      EngineDecisionModel.countDocuments(),
      EngineDecisionModel.aggregate([
        { $group: { _id: '$decision', count: { $sum: 1 } } },
      ]),
      EngineDecisionModel.aggregate([
        { $group: { _id: '$confidenceBand', count: { $sum: 1 } } },
      ]),
      EngineDecisionModel.find({ decision: 'BUY' })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      EngineDecisionModel.aggregate([
        { $match: { 'feedback.helpful': { $ne: null } } },
        { $group: {
          _id: '$feedback.helpful',
          count: { $sum: 1 },
        }},
      ]),
    ]);
    
    return {
      ok: true,
      data: {
        totalDecisions,
        byDecision: byDecision.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {} as Record<string, number>),
        byConfidence: byConfidence.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {} as Record<string, number>),
        recentBuySignals: recentBuys.map((d: any) => ({
          asset: d.asset?.symbol,
          confidence: d.confidenceBand,
          createdAt: d.createdAt,
        })),
        feedback: {
          helpful: feedbackStats.find((f: any) => f._id === true)?.count || 0,
          notHelpful: feedbackStats.find((f: any) => f._id === false)?.count || 0,
        },
        engineVersion: USE_ENGINE_V1_1 ? ENGINE_CONFIG.version : 'v1.0',
      },
    };
  });
  
  /**
   * GET /api/engine/config
   * Get engine v1.1 configuration (for transparency)
   */
  app.get('/engine/config', async () => {
    return {
      ok: true,
      data: {
        version: ENGINE_CONFIG.version,
        activeEngine: USE_ENGINE_V1_1 ? 'v1.1' : 'v1.0',
        thresholds: {
          evidence: ENGINE_CONFIG.evidence,
          coverage: ENGINE_CONFIG.coverage,
          direction: ENGINE_CONFIG.direction,
          risk: ENGINE_CONFIG.risk,
        },
        penalties: ENGINE_CONFIG.penalties,
        conflicts: ENGINE_CONFIG.conflicts,
        stability: ENGINE_CONFIG.stability,
        explainability: ENGINE_CONFIG.explainability,
      },
    };
  });
  
  // ============ KPI ENDPOINTS ============
  
  /**
   * GET /api/engine/kpi
   * Get full KPI summary
   */
  app.get('/engine/kpi', async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days || '7');
    
    try {
      const kpi = await calculateFullKPI(days);
      return {
        ok: true,
        data: kpi,
        thresholds: KPI_THRESHOLDS,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  /**
   * GET /api/engine/kpi/distribution
   * Get decision distribution KPI
   */
  app.get('/engine/kpi/distribution', async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days || '7');
    
    const kpi = await calculateDistributionKPI(days);
    return {
      ok: true,
      data: kpi,
      thresholds: KPI_THRESHOLDS.distribution,
    };
  });
  
  /**
   * GET /api/engine/kpi/coverage
   * Get coverage gating KPI
   */
  app.get('/engine/kpi/coverage', async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days || '7');
    
    const kpi = await calculateCoverageKPI(days);
    return {
      ok: true,
      data: kpi,
      thresholds: KPI_THRESHOLDS.coverage,
    };
  });
  
  /**
   * GET /api/engine/kpi/stability
   * Get stability KPI
   */
  app.get('/engine/kpi/stability', async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days || '7');
    
    const kpi = await calculateStabilityKPI(days);
    return {
      ok: true,
      data: kpi,
      thresholds: KPI_THRESHOLDS.stability,
    };
  });
  
  // ============ ML ENDPOINTS ============
  
  /**
   * GET /api/engine/ml/config
   * Get ML configuration and status
   */
  app.get('/engine/ml/config', async () => {
    return {
      ok: true,
      data: getMLConfig(),
    };
  });
  
  /**
   * POST /api/engine/ml/toggle
   * Toggle ML (admin only)
   */
  app.post('/engine/ml/toggle', async (request: FastifyRequest) => {
    const body = request.body as { enabled: boolean };
    
    setMLEnabled(body.enabled);
    
    return {
      ok: true,
      data: {
        mlEnabled: body.enabled,
        message: body.enabled ? 'ML scoring ENABLED' : 'ML scoring DISABLED (fallback to rules)',
      },
    };
  });
  
  /**
   * GET /api/engine/features
   * Get feature extraction for debugging
   */
  app.get('/engine/features', async (request: FastifyRequest) => {
    const query = request.query as {
      asset?: string;
      actor?: string;
      window?: string;
    };
    
    const window = parseWindow(query.window, '24h');
    
    if (!query.asset && !query.actor) {
      return { ok: false, error: 'Either asset or actor parameter required' };
    }
    
    try {
      let input;
      if (query.actor) {
        input = await buildEngineInputForActor(query.actor, window);
      } else {
        input = await buildEngineInput(query.asset!, window);
      }
      
      const features = extractFeatures(input);
      const mlScoring = calculateMLScoring(features);
      
      return {
        ok: true,
        data: {
          features,
          featureNames: getFeatureNames(),
          mlScoring,
        },
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
  
  // ============ SHADOW MODE ENDPOINTS ============
  
  /**
   * GET /api/engine/shadow/config
   * Get shadow mode configuration
   */
  app.get('/engine/shadow/config', async () => {
    return {
      ok: true,
      data: getShadowConfig(),
    };
  });
  
  /**
   * POST /api/engine/shadow/toggle
   * Toggle shadow mode
   */
  app.post('/engine/shadow/toggle', async (request: FastifyRequest) => {
    const body = request.body as { enabled: boolean };
    
    setShadowEnabled(body.enabled);
    
    return {
      ok: true,
      data: {
        shadowEnabled: body.enabled,
        message: body.enabled ? 'Shadow mode ENABLED' : 'Shadow mode DISABLED',
      },
    };
  });
  
  /**
   * GET /api/engine/shadow/kpi
   * Get shadow mode KPIs (v1.1 vs v2 comparison)
   */
  app.get('/engine/shadow/kpi', async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days || '7');
    
    try {
      const kpis = await calculateShadowKPIs(days);
      return {
        ok: true,
        data: kpis,
        killConditions: SHADOW_CONFIG.killConditions,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
  
  // ============ SIMULATION ENDPOINTS ============
  
  /**
   * POST /api/engine/simulate/replay
   * Run historical replay simulation
   */
  app.post('/engine/simulate/replay', async (request: FastifyRequest) => {
    const body = request.body as { limit?: number };
    const limit = body.limit || 50;
    
    try {
      const result = await runHistoricalReplay(limit);
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
  
  /**
   * POST /api/engine/simulate/perturb
   * Run perturbation stress test
   */
  app.post('/engine/simulate/perturb', async (request: FastifyRequest) => {
    const body = request.body as { 
      actor?: string;
      perturbations?: any[];
    };
    
    try {
      const result = await runPerturbationTest(
        body.actor || 'binance',
        body.perturbations || []
      );
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
  
  /**
   * POST /api/engine/simulate/montecarlo
   * Run Monte Carlo random feature test
   */
  app.post('/engine/simulate/montecarlo', async (request: FastifyRequest) => {
    const body = request.body as { iterations?: number };
    const iterations = body.iterations || 50;
    
    try {
      const result = await runMonteCarloTest(iterations);
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
  
  app.log.info(`Engine routes registered (Engine ${USE_ENGINE_V1_1 ? 'v1.1' : 'v1.0'} + KPI + ML + Shadow + Simulation)`);
}
