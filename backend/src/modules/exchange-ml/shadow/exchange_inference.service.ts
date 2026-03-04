/**
 * Exchange Auto-Learning Loop - PR3: Inference Service
 * 
 * Dual inference layer:
 * - Always returns active model prediction
 * - Asynchronously runs shadow model (non-blocking)
 * - Records comparison for metrics
 * - Applies Cross-Horizon Bias adjustment (sample-weighted)
 * 
 * CRITICAL: Shadow inference MUST NOT increase latency.
 */

import { Db } from 'mongodb';
import {
  InferenceResult,
  ShadowConfig,
  DEFAULT_SHADOW_CONFIG,
  CrossHorizonBiasInfo,
} from './exchange_shadow.types.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';
import { ExchangeModel } from '../training/exchange_training.types.js';
import { getExchangeModelRegistryService } from '../training/exchange_model_registry.service.js';
import { getExchangeModelLoader } from '../training/exchange_model_loader.js';
import { getExchangeShadowRecorderService } from './exchange_shadow_recorder.service.js';
import { getCrossHorizonBiasService } from '../performance/cross-horizon-bias.service.js';
import { getExchangeSnapshotService } from '../snapshots/exchange_snapshot.service.js';

// ═══════════════════════════════════════════════════════════════
// BLOCK 2.4: NO GLOBAL MODEL CACHE
// Every predict() call queries registry for the CURRENT active version.
// This ensures promotion/rollback takes effect immediately.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// INFERENCE SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeInferenceService {
  private config: ShadowConfig;
  
  constructor(private db: Db, config?: Partial<ShadowConfig>) {
    this.config = { ...DEFAULT_SHADOW_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MAIN PREDICT METHOD
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Run inference with dual prediction (active + shadow).
   * 
   * @param params.sampleId - Sample ID for tracking
   * @param params.symbol - Trading symbol
   * @param params.horizon - Forecast horizon
   * @param params.features - Feature vector (normalized)
   * @returns Active model prediction (shadow runs async)
   */
  async predict(params: {
    sampleId: string;
    symbol: string;
    horizon: ExchangeHorizon;
    features: number[];
  }): Promise<InferenceResult> {
    const { sampleId, symbol, horizon, features } = params;
    const startTime = Date.now();
    
    const registryService = getExchangeModelRegistryService(this.db);
    
    // Get registry for this horizon
    // BLOCK 2.4: Registry is SINGLE SOURCE OF TRUTH for active model
    const registry = await registryService.getRegistry(horizon);
    
    if (!registry?.activeModelId) {
      // No active model - return default
      return {
        prediction: 0.5,
        predictedClass: 'LOSS',
        modelId: 'none',
        modelVersion: 0,
        hasShadow: false,
        latencyMs: Date.now() - startTime,
      };
    }
    
    // BLOCK 2.4: Load active model with VERSION VERIFICATION
    // This ensures we get the exact version specified in registry
    const activeModel = await this.loadModel(
      registry.activeModelId,
      registry.activeModelVersion // Pass expected version for validation
    );
    
    if (!activeModel) {
      console.warn(`[Inference] Active model not found: ${registry.activeModelId}`);
      return {
        prediction: 0.5,
        predictedClass: 'LOSS',
        modelId: registry.activeModelId,
        modelVersion: registry.activeModelVersion || 0,
        hasShadow: false,
        latencyMs: Date.now() - startTime,
      };
    }
    
    // BLOCK 2.5: Verify version matches registry (critical safety check)
    if (activeModel.version !== registry.activeModelVersion) {
      console.warn(`[Inference] Version mismatch! Registry: v${registry.activeModelVersion}, Model: v${activeModel.version}`);
      // Continue but log - this shouldn't happen in production
    }
    
    // Run active model inference
    const activePrediction = this.runModelInference(activeModel, features);
    
    // ═══════════════════════════════════════════════════════════════
    // APPLY CROSS-HORIZON BIAS (SAMPLE-WEIGHTED)
    // ═══════════════════════════════════════════════════════════════
    let finalPrediction = activePrediction;
    let crossHorizonBiasInfo: CrossHorizonBiasInfo | undefined;
    
    if (this.isCrossHorizonBiasEnabled()) {
      try {
        const biasService = getCrossHorizonBiasService(this.db);
        const biasResult = await biasService.apply(horizon, activePrediction);
        
        if (biasResult.applied) {
          finalPrediction = biasResult.adjustedConfidence;
          
          crossHorizonBiasInfo = {
            applied: true,
            modifier: biasResult.modifier,
            originalConfidence: activePrediction,
            adjustedConfidence: biasResult.adjustedConfidence,
            breakdown: {
              fromParentHorizon: biasResult.breakdown.fromParentHorizon ? {
                parentHorizon: biasResult.breakdown.fromParentHorizon.parentHorizon,
                parentBias: biasResult.breakdown.fromParentHorizon.parentBias,
                parentSampleCount: biasResult.breakdown.fromParentHorizon.parentSampleCount,
                parentConfidence: biasResult.breakdown.fromParentHorizon.parentConfidence,
                weightedInfluence: biasResult.breakdown.fromParentHorizon.weightedInfluence,
              } : undefined,
              stabilityPenalty: biasResult.breakdown.stabilityPenalty,
              insufficientData: biasResult.breakdown.insufficientData,
            },
          };
        }
      } catch (err) {
        console.error('[Inference] Cross-horizon bias error (ignored):', err);
        // Continue with original prediction
      }
    }
    
    const activeClass = finalPrediction >= this.config.winThreshold ? 'WIN' : 'LOSS';
    
    const latencyMs = Date.now() - startTime;
    
    // Build result
    const result: InferenceResult = {
      prediction: finalPrediction,
      predictedClass: activeClass,
      modelId: activeModel.modelId,
      modelVersion: activeModel.version,
      hasShadow: !!registry.shadowModelId,
      crossHorizonBias: crossHorizonBiasInfo,
      latencyMs,
    };
    
    // Run shadow inference asynchronously (NON-BLOCKING)
    if (registry.shadowModelId && this.isShadowEnabled()) {
      setImmediate(async () => {
        await this.runShadowInference({
          sampleId,
          symbol,
          horizon,
          features,
          activeModelId: activeModel.modelId,
          activeModelVersion: activeModel.version,
          activePrediction: finalPrediction, // Use bias-adjusted prediction
          shadowModelId: registry.shadowModelId!,
          latencyMs,
        });
      });
    }
    
    // Create immutable snapshot (BLOCK 1) - NON-BLOCKING
    if (this.isSnapshotEnabled()) {
      setImmediate(async () => {
        await this.createPredictionSnapshot({
          symbol,
          horizon,
          modelId: activeModel.modelId,
          modelVersion: activeModel.version,
          prediction: activePrediction,
          confidence: finalPrediction,
          biasModifier: crossHorizonBiasInfo?.modifier,
          biasBreakdown: crossHorizonBiasInfo?.breakdown ? {
            fromParentHorizon: crossHorizonBiasInfo.breakdown.fromParentHorizon?.parentHorizon,
            parentBias: crossHorizonBiasInfo.breakdown.fromParentHorizon?.parentBias,
            weightedInfluence: crossHorizonBiasInfo.breakdown.fromParentHorizon?.weightedInfluence,
            decayState: (crossHorizonBiasInfo.breakdown as any)?.decayState,
          } : undefined,
        });
      });
    }
    
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SHADOW INFERENCE (ASYNC)
  // ═══════════════════════════════════════════════════════════════
  
  private async runShadowInference(params: {
    sampleId: string;
    symbol: string;
    horizon: ExchangeHorizon;
    features: number[];
    activeModelId: string;
    activeModelVersion: number;
    activePrediction: number;
    shadowModelId: string;
    latencyMs: number;
  }): Promise<void> {
    const {
      sampleId,
      symbol,
      horizon,
      features,
      activeModelId,
      activeModelVersion,
      activePrediction,
      shadowModelId,
      latencyMs,
    } = params;
    
    try {
      // Load shadow model
      const shadowModel = await this.loadModel(shadowModelId);
      
      if (!shadowModel) {
        console.warn(`[Inference] Shadow model not found: ${shadowModelId}`);
        return;
      }
      
      // Run shadow inference
      const shadowPrediction = this.runModelInference(shadowModel, features);
      
      // Record comparison
      const recorderService = getExchangeShadowRecorderService(this.db);
      
      await recorderService.record({
        sampleId,
        horizon,
        symbol,
        activeModelId,
        activeModelVersion,
        shadowModelId: shadowModel.modelId,
        shadowModelVersion: shadowModel.version,
        activePrediction,
        shadowPrediction,
        winThreshold: this.config.winThreshold,
        latencyMs,
      });
      
    } catch (err) {
      console.error('[Inference] Shadow inference error:', err);
      // Shadow errors don't affect the main flow
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MODEL LOADING (BLOCK 2.4 - Version-Aware)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Load model using the version-aware loader.
   * This ensures we always get the correct version after promotion/rollback.
   */
  private async loadModel(
    modelId: string,
    expectedVersion?: number
  ): Promise<ExchangeModel | null> {
    const loader = getExchangeModelLoader(this.db);
    return loader.loadModel(modelId, expectedVersion);
  }
  
  /**
   * Invalidate model cache after promotion/rollback.
   * Called by registry service.
   */
  invalidateModelCache(modelId?: string): void {
    const loader = getExchangeModelLoader(this.db);
    loader.invalidateCache(modelId);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MODEL INFERENCE
  // ═══════════════════════════════════════════════════════════════
  
  private runModelInference(model: ExchangeModel, features: number[]): number {
    if (model.algo !== 'LOGISTIC_REGRESSION' || !model.artifact.weights) {
      console.warn(`[Inference] Unsupported model type: ${model.algo}`);
      return 0.5;
    }
    
    const weights = model.artifact.weights;
    const bias = model.artifact.bias || 0;
    
    // Normalize features using model's normalization params
    const normalizedFeatures = this.normalizeFeatures(features, model.featureConfig.normalization);
    
    // Compute logit
    let logit = bias;
    for (let i = 0; i < normalizedFeatures.length && i < weights.length; i++) {
      logit += normalizedFeatures[i] * weights[i];
    }
    
    // Sigmoid
    const probability = this.sigmoid(logit);
    
    return probability;
  }
  
  private normalizeFeatures(
    features: number[],
    normalization: Record<string, { mean: number; std: number }>
  ): number[] {
    const featureNames = [
      'priceChange24h',
      'priceChange7d',
      'volumeRatio',
      'rsi14',
      'macdSignal',
      'bbWidth',
      'fundingRate',
      'oiChange24h',
      'sentimentScore',
      'regimeConfidence',
      'btcCorrelation',
      'marketStress',
    ];
    
    return features.map((v, i) => {
      const featureName = featureNames[i] || `feature_${i}`;
      const norm = normalization[featureName];
      
      if (!norm) return v;
      
      return (v - norm.mean) / (norm.std || 1);
    });
  }
  
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private isShadowEnabled(): boolean {
    return process.env.EXCHANGE_SHADOW_ENABLED === 'true';
  }
  
  private isCrossHorizonBiasEnabled(): boolean {
    // Enabled by default unless explicitly disabled
    return process.env.EXCHANGE_CROSS_HORIZON_BIAS_ENABLED !== 'false';
  }
  
  private isSnapshotEnabled(): boolean {
    // Enabled by default unless explicitly disabled
    return process.env.EXCHANGE_SNAPSHOT_ENABLED !== 'false';
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SNAPSHOT CREATION (BLOCK 1)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Create an immutable prediction snapshot.
   * This is called asynchronously to not block inference.
   */
  private async createPredictionSnapshot(params: {
    symbol: string;
    horizon: ExchangeHorizon;
    modelId: string;
    modelVersion: number;
    prediction: number;
    confidence: number;
    biasModifier?: number;
    biasBreakdown?: {
      fromParentHorizon?: string;
      parentBias?: number;
      weightedInfluence?: number;
      decayState?: string;
    };
  }): Promise<void> {
    const { symbol, horizon, modelId, modelVersion, prediction, confidence, biasModifier, biasBreakdown } = params;
    
    try {
      const snapshotService = getExchangeSnapshotService(this.db);
      
      // Get current price for entry (in production, this would come from real price feed)
      // For now, use a placeholder - this should be injected from the caller
      const entryPrice = await this.getCurrentPrice(symbol);
      
      if (entryPrice === null) {
        console.warn(`[Inference] Could not get entry price for ${symbol}, skipping snapshot`);
        return;
      }
      
      const predictedClass = confidence >= this.config.winThreshold ? 'WIN' : 'LOSS';
      
      await snapshotService.archiveAndCreate({
        symbol,
        horizon,
        modelId,
        modelVersion,
        prediction,
        predictedClass,
        confidence,
        entryPrice,
        biasModifier,
        biasBreakdown,
      });
      
      console.log(`[Inference] Snapshot created for ${symbol} ${horizon}: ${predictedClass} (${(confidence * 100).toFixed(1)}%)`);
      
    } catch (err) {
      console.error('[Inference] Failed to create snapshot:', err);
      // Non-blocking - don't throw
    }
  }
  
  /**
   * Get current price for a symbol.
   * TODO: In production, this should use a real price feed.
   */
  private async getCurrentPrice(symbol: string): Promise<number | null> {
    try {
      // Try to get from feature builder (which has price data)
      const { getExchangeFeatureBuilder } = await import('../dataset/exchange_feature_builder.js');
      const featureBuilder = getExchangeFeatureBuilder(this.db);
      const features = await featureBuilder.buildFeatures(symbol);
      return features?.price ?? null;
    } catch (err) {
      console.error(`[Inference] Failed to get price for ${symbol}:`, err);
      return null;
    }
  }
  
  /**
   * Clear model cache (useful for testing).
   */
  clearCache(): void {
    modelCache.clear();
  }
  
  /**
   * Get cache stats.
   */
  getCacheStats(): { size: number; models: string[] } {
    return {
      size: modelCache.size,
      models: Array.from(modelCache.keys()),
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let inferenceInstance: ExchangeInferenceService | null = null;

export function getExchangeInferenceService(db: Db): ExchangeInferenceService {
  if (!inferenceInstance) {
    inferenceInstance = new ExchangeInferenceService(db);
  }
  return inferenceInstance;
}

console.log('[Exchange ML] Inference service loaded');
