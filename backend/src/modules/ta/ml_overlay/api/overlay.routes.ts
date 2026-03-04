/**
 * Phase L: ML Overlay API Routes
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Db } from 'mongodb';
import { MLOverlayService, initOverlayIndexes } from '../overlay_service.js';
import { OverlayConfig, DEFAULT_OVERLAY_CONFIG } from '../overlay_types.js';
import { listAvailableModels, loadLocalModel, getMockModel } from '../model_registry.js';
import { getFeatureSchema } from '../feature_schema.js';
import { buildFeatureMap, extractOverlayFeatures } from '../feature_builder.js';
import { getRecommendedMode, isModelReady } from '../overlay_gates.js';

export interface OverlayRouteDeps {
  db: Db;
}

// Config store (in-memory, could be moved to MongoDB)
let currentConfig: OverlayConfig = { ...DEFAULT_OVERLAY_CONFIG };

export async function registerOverlayRoutes(
  app: FastifyInstance,
  deps: OverlayRouteDeps
): Promise<void> {
  const { db } = deps;

  // Initialize service and indexes
  initOverlayIndexes(db).catch(console.error);
  
  const overlayService = new MLOverlayService({
    db,
    config: currentConfig,
  });

  // ═══════════════════════════════════════════════════════════════
  // Status & Config
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/ta/ml_overlay/status
   * Get ML overlay status
   */
  app.get('/ml_overlay/status', async () => {
    const models = listAvailableModels();
    const activeModel = currentConfig.provider === 'mock' 
      ? getMockModel() 
      : loadLocalModel(currentConfig.modelVersion);

    return {
      ok: true,
      phase: 'L',
      description: 'ML Overlay — Probability refinement layer',
      config: currentConfig,
      models: {
        available: models,
        active: activeModel.version,
        metrics: activeModel.metrics,
        isReady: isModelReady(activeModel.metrics),
        recommendedMode: getRecommendedMode(activeModel.metrics),
      },
    };
  });

  /**
   * GET /api/ta/ml_overlay/config
   * Get current config
   */
  app.get('/ml_overlay/config', async () => {
    return {
      ok: true,
      config: currentConfig,
    };
  });

  /**
   * PATCH /api/ta/ml_overlay/config
   * Update config
   */
  app.patch('/ml_overlay/config', async (request: FastifyRequest<{
    Body: Partial<OverlayConfig>
  }>) => {
    const patch = request.body || {};
    
    // Validate mode
    if (patch.mode && !['OFF', 'SHADOW', 'LIVE_LITE', 'LIVE_MED', 'LIVE_FULL'].includes(patch.mode)) {
      return { ok: false, error: `Invalid mode: ${patch.mode}` };
    }

    // Validate mlAlpha
    if (typeof patch.mlAlpha === 'number' && (patch.mlAlpha < 0 || patch.mlAlpha > 1)) {
      return { ok: false, error: 'mlAlpha must be between 0 and 1' };
    }

    currentConfig = { ...currentConfig, ...patch };
    overlayService.updateConfig(currentConfig);

    return {
      ok: true,
      config: currentConfig,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // Prediction
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /api/ta/ml_overlay/predict
   * Run ML prediction on a scenario
   */
  app.post('/ml_overlay/predict', async (request: FastifyRequest<{
    Body: {
      runId: string;
      scenarioId: string;
      asset: string;
      timeframe?: string;
      score: number;
      baseProbability: number;
      features?: Record<string, number | string>;
    }
  }>) => {
    const body = request.body || {};

    if (!body.runId || !body.scenarioId) {
      return { ok: false, error: 'runId and scenarioId are required' };
    }

    if (typeof body.baseProbability !== 'number') {
      return { ok: false, error: 'baseProbability is required' };
    }

    // Build features if not provided
    let features = body.features || {};
    if (!features.score) {
      features = buildFeatureMap({
        score: body.score || body.baseProbability,
        calibratedProbability: body.baseProbability,
        marketRegime: (features.marketRegime as string) || 'TRANSITION',
        volRegime: (features.volRegime as string) || 'NORMAL',
        rrToT1: Number(features.rrToT1) || 0,
        rrToT2: Number(features.rrToT2) || 0,
        riskPct: Number(features.riskPct) || 0,
        rewardPct: Number(features.rewardPct) || 0,
        ma20Slope: Number(features.ma20Slope) || 0,
        ma50Slope: Number(features.ma50Slope) || 0,
        maAlignment: Number(features.maAlignment) || 0,
        atrPercentile: Number(features.atrPercentile) || 0.5,
        compression: Number(features.compression) || 0,
        patternCount: Number(features.patternCount) || 0,
        confluenceScore: Number(features.confluenceScore) || 0,
        confluenceFactors: Number(features.confluenceFactors) || 0,
        trendAlignment: Number(features.trendAlignment) || 0,
      });
    }

    const result = await overlayService.predict({
      runId: body.runId,
      scenarioId: body.scenarioId,
      asset: body.asset,
      timeframe: body.timeframe || '1D',
      score: body.score || body.baseProbability,
      baseProbability: body.baseProbability,
      features,
    });

    return result;
  });

  // ═══════════════════════════════════════════════════════════════
  // Audit & History
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/ta/ml_overlay/predictions/latest
   * Get recent predictions
   */
  app.get('/ml_overlay/predictions/latest', async (request: FastifyRequest<{
    Querystring: { asset?: string; tf?: string; limit?: string }
  }>) => {
    const { asset = 'BTCUSDT', tf = '1D', limit = '50' } = request.query;

    const predictions = await overlayService.getRecentPredictions(
      asset,
      tf,
      parseInt(limit, 10)
    );

    return {
      ok: true,
      asset,
      timeframe: tf,
      count: predictions.length,
      predictions,
    };
  });

  /**
   * GET /api/ta/ml_overlay/predictions/stats
   * Get prediction statistics
   */
  app.get('/ml_overlay/predictions/stats', async () => {
    const total = await db.collection('ta_ml_predictions').countDocuments();
    const byMode = await db.collection('ta_ml_predictions').aggregate([
      { $group: { _id: '$mode', count: { $sum: 1 } } }
    ]).toArray();

    const gatedCount = await db.collection('ta_ml_predictions').countDocuments({ gated: true });

    return {
      ok: true,
      stats: {
        total,
        byMode: Object.fromEntries(byMode.map(m => [m._id, m.count])),
        gatedCount,
        gatedRate: total > 0 ? gatedCount / total : 0,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // Models & Schema
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/ta/ml_overlay/models
   * List available models
   */
  app.get('/ml_overlay/models', async () => {
    const models = listAvailableModels();
    
    return {
      ok: true,
      count: models.length,
      models: models.map(version => {
        const model = version === 'mock_v1' ? getMockModel() : loadLocalModel(version);
        return {
          version: model.version,
          metrics: model.metrics,
          isReady: isModelReady(model.metrics),
          recommendedMode: getRecommendedMode(model.metrics),
        };
      }),
    };
  });

  /**
   * GET /api/ta/ml_overlay/schema
   * Get feature schema
   */
  app.get('/ml_overlay/schema', async () => {
    return {
      ok: true,
      schema: getFeatureSchema(),
    };
  });

  /**
   * POST /api/ta/ml_overlay/features/extract
   * Extract features from scenario/run
   */
  app.post('/ml_overlay/features/extract', async (request: FastifyRequest<{
    Body: { scenario: any; run?: any }
  }>) => {
    const { scenario, run } = request.body || {};

    if (!scenario) {
      return { ok: false, error: 'scenario is required' };
    }

    const features = extractOverlayFeatures(scenario, run || {});
    const featureMap = buildFeatureMap(features);

    return {
      ok: true,
      features,
      featureMap,
      featureCount: Object.keys(featureMap).length,
    };
  });
}
