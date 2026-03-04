/**
 * P8.0-B1+B2 — Forecast Pipeline Service
 * 
 * Main entry point for quantile forecasting.
 * Pipeline: Features → Model (trained MoE or baseline) → Postprocess → Response
 */

import * as crypto from 'crypto';
import {
  QuantileForecastResponse,
  Horizon,
  HORIZONS,
  MODEL_VERSION,
  validateForecast,
} from '../contracts/quantile_forecast.contract.js';
import { FEATURES_VERSION } from '../contracts/feature_vector.contract.js';
import { getFeatureBuilderService } from './feature_builder.service.js';
import { getBaselineQuantileModelService } from './quantile_model.service.js';
import { getQuantileMixtureService } from './quantile_mixture.service.js';
import { getQuantileModelRepo } from '../storage/quantile_model.repo.js';
import { getMacroEnginePack } from '../../adapters/sources.adapter.js';
import { TrainedModelWeights } from '../contracts/quantile_train.contract.js';

// ═══════════════════════════════════════════════════════════════
// FORECAST PIPELINE SERVICE
// ═══════════════════════════════════════════════════════════════

// Cache trained model in memory
let cachedModel: TrainedModelWeights | null = null;
let cachedModelAsset: string | null = null;

export class ForecastPipelineService {
  
  /**
   * Main entry: generate quantile forecast for asset
   */
  async generateForecast(asset: string, asOf: string): Promise<QuantileForecastResponse> {
    const startTime = Date.now();
    
    // 1. Build feature vector
    const featureService = getFeatureBuilderService();
    const features = await featureService.buildFeatures(asset, asOf);
    
    // 2. Get regime probabilities from macro engine
    const macroPack = await getMacroEnginePack(asset as any, asOf);
    const regimeProbs = this.extractRegimeProbs(macroPack);
    const dominantRegime = this.getDominantRegime(regimeProbs);
    
    // 3. Try to use trained MoE model, fallback to baseline
    const trainedWeights = await this.getTrainedModel(asset);
    
    let byHorizon: Record<Horizon, any>;
    let modelInfo: { version: string; isBaseline: boolean; trainedAt: string | null; weightsId: string | null };
    
    if (trainedWeights) {
      // Use trained MoE model
      const mixtureService = getQuantileMixtureService();
      byHorizon = mixtureService.predictMoE(trainedWeights, features.vector, regimeProbs);
      modelInfo = {
        version: trainedWeights.modelVersion,
        isBaseline: false,
        trainedAt: trainedWeights.trainedAt,
        weightsId: `weights_${asset}`,
      };
      console.log(`[Forecast] Using trained MoE model for ${asset} (trained: ${trainedWeights.trainedAt})`);
    } else {
      // Fallback to baseline
      const baselineService = getBaselineQuantileModelService();
      byHorizon = baselineService.getForecast(regimeProbs, features.vector);
      const baseInfo = baselineService.getModelInfo();
      modelInfo = {
        version: baseInfo.version,
        isBaseline: baseInfo.isBaseline,
        trainedAt: baseInfo.trainedAt,
        weightsId: null,
      };
    }
    
    // 4. Compute integrity hash
    const inputsHash = this.computeInputsHash(features.integrity.inputsHash, regimeProbs, asOf);
    
    // 5. Build response
    const response: QuantileForecastResponse = {
      asset,
      asOf,
      featuresVersion: FEATURES_VERSION,
      model: {
        modelVersion: modelInfo.version,
        activeWeightsId: modelInfo.weightsId,
        trainedAt: modelInfo.trainedAt,
        isBaseline: modelInfo.isBaseline,
      },
      regime: {
        dominant: dominantRegime,
        p: regimeProbs,
      },
      byHorizon,
      integrity: {
        inputsHash,
        noLookahead: true,
        computeTimeMs: Date.now() - startTime,
      },
    };
    
    // 6. Validate
    const validation = validateForecast(response);
    if (!validation.valid) {
      console.warn('[Forecast] Validation warnings:', validation.errors);
    }
    
    return response;
  }
  
  /**
   * Get trained model (with in-memory cache)
   */
  private async getTrainedModel(asset: string): Promise<TrainedModelWeights | null> {
    // Return cached if same asset
    if (cachedModel && cachedModelAsset === asset) {
      return cachedModel;
    }
    
    try {
      const repo = getQuantileModelRepo();
      const weights = await repo.loadActive(asset);
      if (weights) {
        cachedModel = weights;
        cachedModelAsset = asset;
      }
      return weights;
    } catch (e) {
      console.warn('[Forecast] Failed to load trained model:', (e as Error).message);
      return null;
    }
  }
  
  /**
   * Invalidate model cache (call after training)
   */
  invalidateCache(): void {
    cachedModel = null;
    cachedModelAsset = null;
  }
  
  /**
   * Extract regime probabilities from macro pack
   * Supports both 'posterior' (old format) and 'probs' (new format)
   */
  private extractRegimeProbs(macroPack: any): Record<string, number> {
    const probs = macroPack?.regime?.probs || macroPack?.regime?.posterior || {};
    
    return {
      EASING: probs['EASING'] || 0,
      TIGHTENING: probs['TIGHTENING'] || 0,
      STRESS: probs['STRESS'] || 0,
      NEUTRAL: probs['NEUTRAL'] || 0,
      NEUTRAL_MIXED: probs['MIXED'] || probs['NEUTRAL_MIXED'] || 0,
    };
  }
  
  /**
   * Get dominant regime (highest probability)
   */
  private getDominantRegime(probs: Record<string, number>): string {
    let maxProb = 0;
    let dominant = 'NEUTRAL';
    
    for (const [regime, prob] of Object.entries(probs)) {
      if (prob > maxProb) {
        maxProb = prob;
        dominant = regime;
      }
    }
    
    if (maxProb < 0.3) {
      return 'NEUTRAL';
    }
    
    return dominant;
  }
  
  /**
   * Compute integrity hash
   */
  private computeInputsHash(
    featuresHash: string,
    regimeProbs: Record<string, number>,
    asOf: string
  ): string {
    const serialized = JSON.stringify({
      featuresHash,
      regimeProbs,
      asOf,
    });
    
    return crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 16);
  }
  
  /**
   * Get forecast status
   */
  async getStatus(asset: string): Promise<{
    asset: string;
    modelVersion: string;
    available: boolean;
    trainedAt: string | null;
    featuresVersion: string;
    isBaseline: boolean;
    coverage: Record<string, boolean>;
  }> {
    // Check for trained model first
    try {
      const repo = getQuantileModelRepo();
      const status = await repo.getStatus(asset);
      
      if (status.available) {
        const weights = await repo.loadActive(asset);
        const droppedExperts = weights?.droppedExperts || [];
        
        return {
          asset,
          modelVersion: status.modelVersion || 'qv1_moe',
          available: true,
          trainedAt: status.trainedAt,
          featuresVersion: FEATURES_VERSION,
          isBaseline: false,
          coverage: {
            EASING: !droppedExperts.includes('EASING'),
            TIGHTENING: !droppedExperts.includes('TIGHTENING'),
            STRESS: !droppedExperts.includes('STRESS'),
            NEUTRAL: !droppedExperts.includes('NEUTRAL'),
            NEUTRAL_MIXED: !droppedExperts.includes('NEUTRAL_MIXED'),
          },
        };
      }
    } catch {
      // Fallback to baseline status
    }
    
    // Baseline status
    const modelService = getBaselineQuantileModelService();
    const modelInfo = modelService.getModelInfo();
    
    return {
      asset,
      modelVersion: modelInfo.version,
      available: modelService.isAvailable(),
      trainedAt: modelInfo.trainedAt,
      featuresVersion: FEATURES_VERSION,
      isBaseline: modelInfo.isBaseline,
      coverage: {
        EASING: true,
        TIGHTENING: true,
        STRESS: true,
        NEUTRAL: true,
        NEUTRAL_MIXED: false,
      },
    };
  }
}

// Singleton
let instance: ForecastPipelineService | null = null;

export function getForecastPipelineService(): ForecastPipelineService {
  if (!instance) {
    instance = new ForecastPipelineService();
  }
  return instance;
}
