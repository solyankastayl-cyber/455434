/**
 * P3.0 Market Predict Service
 * 
 * Predicts market direction: BUY / SELL / NEUTRAL
 * Based on market features from feature store
 * 
 * P3.5: Uses trained LightGBM model via Python ML service
 * P0.1: Timeout, retry, circuit-breaker, logging
 */

import { loadLatestMarketModel } from './model_loader.js';
import { FeatureMarketModel } from '../features/feature.models.js';
import { callMarketPredict } from './ml_python_client.js';
import { logMarketInference } from './ml_inference_log.model.js';
import type { MarketPrediction } from './ml_inference.types.js';

/**
 * Map market regime to probability boost (used as fallback)
 */
function regimeToBoost(regime: string): number {
  switch (regime) {
    case 'ACCUMULATION': return 0.1;
    case 'DISTRIBUTION': return -0.1;
    default: return 0;
  }
}

export class MarketPredictService {
  
  /**
   * Predict market direction for network
   */
  static async predict(network: string, timeBucket?: number): Promise<MarketPrediction> {
    const startTs = Date.now();
    const model = loadLatestMarketModel();
    
    // Get latest market features
    const query: any = { network };
    if (timeBucket) {
      query.bucketTs = { $lte: timeBucket };
    }
    
    const feature = await FeatureMarketModel
      .findOne(query)
      .sort({ bucketTs: -1 })
      .lean();
    
    if (!feature) {
      // Return neutral prediction when no data
      return {
        network,
        timeBucket: timeBucket || Math.floor(Date.now() / 1000),
        pUp: 0.5,
        pDown: 0.5,
        confidence: 0,
        mlSignal: 'NEUTRAL',
        modelVersion: model.version,
      };
    }
    
    // Extract features
    const exchangePressure = feature.cexPressure?.pressure?.w24h || 0;
    const accStrength = feature.zones?.accumulationStrength?.w7d || 0.5;
    const distStrength = feature.zones?.distributionStrength?.w7d || 0.5;
    const corridorEntropy = feature.corridors?.entropy?.w7d || 0.5;
    const marketRegime = feature.zones?.marketRegime || 'NEUTRAL';
    
    const features = {
      exchangePressure,
      accZoneStrength: accStrength,
      distZoneStrength: distStrength,
      corridorsEntropy: corridorEntropy,
    };
    
    // P3.5 + P0.1: Try Python ML service with timeout/retry/circuit-breaker
    const mlResult = await callMarketPredict({
      network,
      features,
      timeBucket: feature.bucketTs,
    });
    
    if (mlResult.success && mlResult.data) {
      const prediction: MarketPrediction = {
        network: mlResult.data.network,
        timeBucket: mlResult.data.timeBucket,
        pUp: mlResult.data.pUp,
        pDown: mlResult.data.pDown,
        confidence: mlResult.data.confidence,
        mlSignal: mlResult.data.mlSignal,
        modelVersion: mlResult.data.modelVersion,
      };
      
      // Log successful ML inference
      logMarketInference({
        network,
        modelVersion: prediction.modelVersion,
        wasFallback: false,
        features,
        result: {
          pUp: prediction.pUp,
          pDown: prediction.pDown,
          signal: prediction.mlSignal,
          confidence: prediction.confidence,
        },
        latencyMs: mlResult.latencyMs,
      });
      
      return prediction;
    }
    
    // FALLBACK: Simple baseline model (no Python needed)
    let rawScore = 0;
    
    // Exchange pressure: negative = buy signal, positive = sell signal
    rawScore += -exchangePressure * 0.4;
    
    // Zone strength difference
    rawScore += (accStrength - distStrength) * 0.35;
    
    // Regime boost
    rawScore += regimeToBoost(marketRegime) * 0.15;
    
    // Low entropy = concentrated flows = stronger signal
    rawScore += (0.5 - corridorEntropy) * 0.1;
    
    // Convert to probability using sigmoid
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x * 2));
    const pUp = sigmoid(rawScore);
    const pDown = 1 - pUp;
    
    // Calculate confidence
    const confidence = Math.min(1, Math.abs(rawScore) * 2);
    
    // Determine signal
    let mlSignal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    if (pUp >= 0.6) mlSignal = 'BUY';
    else if (pUp <= 0.4) mlSignal = 'SELL';
    
    const prediction: MarketPrediction = {
      network,
      timeBucket: feature.bucketTs,
      pUp: Math.round(pUp * 10000) / 10000,
      pDown: Math.round(pDown * 10000) / 10000,
      confidence: Math.round(confidence * 10000) / 10000,
      mlSignal,
      modelVersion: `${model.version}_fallback`,
    };
    
    // Log fallback inference
    logMarketInference({
      network,
      modelVersion: prediction.modelVersion,
      wasFallback: true,
      features,
      result: {
        pUp: prediction.pUp,
        pDown: prediction.pDown,
        signal: prediction.mlSignal,
        confidence: prediction.confidence,
      },
      latencyMs: Date.now() - startTs,
    });
    
    return prediction;
  }
  
  /**
   * Get predictions for all networks
   */
  static async predictAll(): Promise<Record<string, MarketPrediction>> {
    const networks = [
      'ethereum', 'arbitrum', 'optimism', 'base', 
      'polygon', 'bnb', 'zksync', 'scroll'
    ];
    
    const results: Record<string, MarketPrediction> = {};
    
    for (const network of networks) {
      results[network] = await this.predict(network);
    }
    
    return results;
  }
}

export default MarketPredictService;
