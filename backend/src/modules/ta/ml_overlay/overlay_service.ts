/**
 * Phase L: ML Overlay Service
 * 
 * Core service for ML probability refinement
 */

import { Db } from 'mongodb';
import {
  OverlayConfig,
  OverlayInput,
  OverlayOutput,
  OverlayMode,
  DEFAULT_OVERLAY_CONFIG,
  MLPredictionDoc,
} from './overlay_types.js';
import { gateOverlay } from './overlay_gates.js';
import { loadLocalModel, getMockModel, modelExists } from './model_registry.js';
import { featureMapToVector } from './feature_builder.js';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, isNaN(x) ? 0.5 : x));
}

export interface OverlayServiceDeps {
  db: Db;
  config?: OverlayConfig;
  inferFn?: (artifactPath: string, featureVector: number[]) => Promise<number>;
}

export class MLOverlayService {
  private db: Db;
  private config: OverlayConfig;
  private inferFn: (artifactPath: string, featureVector: number[]) => Promise<number>;

  constructor(deps: OverlayServiceDeps) {
    this.db = deps.db;
    this.config = deps.config || { ...DEFAULT_OVERLAY_CONFIG };
    this.inferFn = deps.inferFn || this.mockInference.bind(this);
  }

  /**
   * Mock inference for testing (no actual ML model)
   */
  private async mockInference(_artifactPath: string, featureVector: number[]): Promise<number> {
    // Simple mock: blend score + some noise
    const score = featureVector[0] || 0.5;
    const noise = (Math.random() - 0.5) * 0.1;
    return clamp01(score + noise);
  }

  /**
   * Get alpha based on mode
   */
  private alphaForMode(mode: OverlayMode, mlAlpha: number): number {
    switch (mode) {
      case 'LIVE_LITE': return Math.min(mlAlpha, 0.10);
      case 'LIVE_MED': return Math.min(mlAlpha, 0.35);
      case 'LIVE_FULL': return mlAlpha;
      default: return 0;
    }
  }

  /**
   * Main prediction method
   */
  async predict(input: OverlayInput): Promise<OverlayOutput> {
    const cfg = this.config;
    const pBase = clamp01(input.baseProbability);
    const computedAt = Date.now();

    // Mode OFF: return base probability
    if (cfg.mode === 'OFF') {
      return {
        ok: true,
        mode: cfg.mode,
        modelVersion: cfg.modelVersion,
        pBase,
        pML: pBase,
        pFinal: pBase,
        alphaUsed: 0,
        gated: true,
        gateReasons: ['MODE_OFF'],
        computedAt,
      };
    }

    // Load model
    let model;
    if (cfg.provider === 'mock' || !modelExists(cfg.modelVersion)) {
      model = getMockModel();
    } else {
      model = loadLocalModel(cfg.modelVersion);
    }

    // Build feature vector
    const featureOrder: string[] = model.schema.feature_order || [];
    const featureMap = input.features as Record<string, number>;
    const vector = featureMapToVector(featureMap, featureOrder);

    // Get ML prediction
    const pML = clamp01(await this.inferFn(model.artifactPath, vector));

    // Check gates
    const gateResult = gateOverlay({
      config: {
        maxDelta: cfg.maxDelta,
        minRowsToEnable: cfg.minRowsToEnable,
        minAucToEnable: cfg.minAucToEnable,
      },
      modelMetrics: model.metrics,
      pBase,
      pML,
    });

    // Calculate alpha
    const alpha = this.alphaForMode(cfg.mode, cfg.mlAlpha);
    const alphaUsed = (cfg.mode === 'SHADOW' || gateResult.gated) ? 0 : alpha;

    // Blend probabilities
    const pFinal = clamp01((1 - alphaUsed) * pBase + alphaUsed * pML);

    // Save to audit collection
    const auditDoc: MLPredictionDoc = {
      runId: input.runId,
      scenarioId: input.scenarioId,
      asset: input.asset,
      timeframe: input.timeframe,
      modelVersion: model.version,
      mode: cfg.mode,
      pBase,
      pML,
      pFinal,
      alphaUsed,
      gated: gateResult.gated,
      gateReasons: cfg.mode === 'SHADOW' ? ['SHADOW_MODE'] : gateResult.reasons,
      computedAt: new Date(),
    };

    try {
      await this.db.collection('ta_ml_predictions').insertOne(auditDoc);
    } catch (err) {
      console.warn('[ML Overlay] Failed to save prediction audit:', err);
    }

    return {
      ok: true,
      mode: cfg.mode,
      modelVersion: model.version,
      pBase,
      pML,
      pFinal,
      alphaUsed,
      gated: gateResult.gated || cfg.mode === 'SHADOW',
      gateReasons: cfg.mode === 'SHADOW' ? ['SHADOW_MODE'] : gateResult.reasons,
      computedAt,
    };
  }

  /**
   * Get current config
   */
  getConfig(): OverlayConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(patch: Partial<OverlayConfig>): OverlayConfig {
    this.config = { ...this.config, ...patch };
    return this.config;
  }

  /**
   * Get recent predictions
   */
  async getRecentPredictions(
    asset: string,
    timeframe: string,
    limit = 50
  ): Promise<MLPredictionDoc[]> {
    return await this.db.collection('ta_ml_predictions')
      .find({ asset, timeframe })
      .sort({ computedAt: -1 })
      .limit(limit)
      .project({ _id: 0 })
      .toArray() as MLPredictionDoc[];
  }
}

/**
 * Initialize overlay indexes
 */
export async function initOverlayIndexes(db: Db): Promise<void> {
  try {
    await db.collection('ta_ml_predictions').createIndex(
      { runId: 1, scenarioId: 1 },
      { background: true }
    );
    await db.collection('ta_ml_predictions').createIndex(
      { asset: 1, timeframe: 1, computedAt: -1 },
      { background: true }
    );
    await db.collection('ta_ml_predictions').createIndex(
      { mode: 1, computedAt: -1 },
      { background: true }
    );
    console.log('[ML Overlay] Indexes initialized');
  } catch (err) {
    console.error('[ML Overlay] Failed to create indexes:', err);
  }
}
