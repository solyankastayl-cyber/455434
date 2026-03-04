/**
 * P3.1 Actor Predict Service
 * 
 * Predicts actor quality: SMART / NEUTRAL / NOISY
 * Based on behavioral features from feature store
 * 
 * P3.5: Uses trained LightGBM model via Python ML service
 * P0.1: Timeout, retry, circuit-breaker, logging
 */

import { loadActorModel } from './model_loader.js';
import { FeatureActorModel } from '../features/feature.models.js';
import { callActorPredict } from './ml_python_client.js';
import { logActorInference } from './ml_inference_log.model.js';
import type { ActorFeatures, ActorClass, ActorPrediction } from './ml_inference.types.js';

/**
 * Softmax function for probability distribution (fallback)
 */
function softmax(arr: number[]): number[] {
  const maxVal = Math.max(...arr);
  const exps = arr.map(x => Math.exp(x - maxVal)); // subtract max for numerical stability
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => v / sum);
}

/**
 * Calculate confidence from probability distribution
 * Higher when one class dominates
 */
function calculateConfidence(probs: number[]): number {
  const sorted = [...probs].sort((a, b) => b - a);
  return sorted[0] - sorted[1]; // difference between top 2
}

/**
 * Extract features from feature store document
 */
function extractFeatures(doc: any): ActorFeatures {
  return {
    inflowUsd: doc.flows?.inUsd?.w24h || 0,
    outflowUsd: doc.flows?.outUsd?.w24h || 0,
    netFlowUsd: doc.flows?.netUsd?.w24h || 0,
    roleScore: doc.scores?.influenceScore || 0,
    exchangeExposure: ((doc.exposure?.cexInUsd?.w24h || 0) + (doc.exposure?.cexOutUsd?.w24h || 0)) / 
                      Math.max(1, (doc.flows?.inUsd?.w24h || 0) + (doc.flows?.outUsd?.w24h || 0)),
    corridorDensity: (doc.structure?.fanIn?.w24h || 0) + (doc.structure?.fanOut?.w24h || 0),
    corridorPersistence: doc.activity?.txCount?.w7d ? 
                         (doc.activity?.txCount?.w24h || 0) / doc.activity.txCount.w7d : 0,
    volatility: Math.abs(doc.structure?.entropyOut?.w24h || 0),
  };
}

/**
 * Extract P3.5 topology features for ML model
 */
function extractP35Features(doc: any): {
  netFlowUsd: number;
  inflowUsd: number;
  outflowUsd: number;
  hubScore: number;
  pagerank: number;
  brokerScore: number;
  kCore: number;
  entropyOut: number;
  exchangeExposure: number;
  corridorDensity: number;
} {
  return {
    netFlowUsd: doc.flows?.netUsd?.w24h || 0,
    inflowUsd: doc.flows?.inUsd?.w24h || 0,
    outflowUsd: doc.flows?.outUsd?.w24h || 0,
    hubScore: doc.topology?.hubScore || doc.scores?.influenceScore || 0,
    pagerank: doc.topology?.pagerank || 0,
    brokerScore: doc.topology?.brokerScore || 0,
    kCore: doc.topology?.kCore || 1,
    entropyOut: doc.structure?.entropyOut?.w24h || 0.5,
    exchangeExposure: ((doc.exposure?.cexInUsd?.w24h || 0) + (doc.exposure?.cexOutUsd?.w24h || 0)) / 
                      Math.max(1, (doc.flows?.inUsd?.w24h || 0) + (doc.flows?.outUsd?.w24h || 0)),
    corridorDensity: ((doc.structure?.fanIn?.w24h || 0) + (doc.structure?.fanOut?.w24h || 0)) / 100,
  };
}

/**
 * Normalize features for fallback model input
 */
function normalizeFeatures(features: ActorFeatures): number[] {
  // Log-scale normalization for volume features
  const logNorm = (x: number) => Math.log1p(Math.abs(x)) * Math.sign(x);
  
  return [
    logNorm(features.inflowUsd) / 15,      // ~log(1M) normalization
    logNorm(features.outflowUsd) / 15,
    logNorm(features.netFlowUsd) / 15,
    features.roleScore,                     // already 0-1
    Math.min(1, features.exchangeExposure), // clamp to 0-1
    Math.min(1, features.corridorDensity / 100), // normalize by ~P95
    features.corridorPersistence,           // already ~0-1
    features.volatility,                    // already ~0-1
  ];
}

export class ActorPredictService {
  
  /**
   * Predict actor class
   */
  static async predict(network: string, actorId: string): Promise<ActorPrediction> {
    const startTs = Date.now();
    const model = loadActorModel();
    
    // Get latest features for actor
    const featureDoc = await FeatureActorModel
      .findOne({ network, actorId: actorId.toLowerCase() })
      .sort({ bucketTs: -1 })
      .lean();
    
    if (!featureDoc) {
      // Return neutral prediction for unknown actors
      return {
        actorId,
        network,
        prediction: {
          class: 'NEUTRAL',
          score: 0.5,
          confidence: 0,
          probs: [0.33, 0.34, 0.33],
        },
        featuresUsed: {
          inflowUsd: 0,
          outflowUsd: 0,
          netFlowUsd: 0,
          roleScore: 0,
          exchangeExposure: 0,
          corridorDensity: 0,
          corridorPersistence: 0,
          volatility: 0,
        },
        modelVersion: model.version,
      };
    }
    
    // P3.5 + P0.1: Use Python ML service with timeout/retry/circuit-breaker
    const p35Features = extractP35Features(featureDoc);
    const mlResult = await callActorPredict({
      network,
      actorId,
      features: p35Features,
    });
    
    if (mlResult.success && mlResult.data) {
      // Convert ML service result to ActorPrediction format
      const probs = [
        mlResult.data.probabilities['SMART'] || 0,
        mlResult.data.probabilities['NEUTRAL'] || 0,
        mlResult.data.probabilities['NOISY'] || 0,
      ];
      
      const prediction: ActorPrediction = {
        actorId,
        network,
        prediction: {
          class: mlResult.data.label,
          score: mlResult.data.confidence,
          confidence: mlResult.data.confidence,
          probs,
        },
        featuresUsed: extractFeatures(featureDoc),
        modelVersion: mlResult.data.modelVersion,
      };
      
      // Log successful inference
      logActorInference({
        network,
        actorId,
        modelVersion: prediction.modelVersion,
        wasFallback: false,
        features: p35Features,
        result: {
          label: mlResult.data.label,
          confidence: mlResult.data.confidence,
          probabilities: mlResult.data.probabilities,
        },
        latencyMs: mlResult.latencyMs,
      });
      
      return prediction;
    }
    
    // FALLBACK: Use baseline model
    const features = extractFeatures(featureDoc);
    const x = normalizeFeatures(features);
    
    // Linear model: z = w·x + b
    const z = x.reduce((sum, val, i) => sum + val * model.weights[i], 0) + model.bias;
    
    // Multi-class logits (SMART=positive, NEUTRAL=0, NOISY=negative)
    const logits = [z, 0, -z];
    
    // Softmax for probabilities
    const probs = softmax(logits);
    
    // Find predicted class
    const maxIdx = probs.indexOf(Math.max(...probs));
    const predictedClass = model.classes[maxIdx] as ActorClass;
    
    const fallbackPrediction: ActorPrediction = {
      actorId,
      network,
      prediction: {
        class: predictedClass,
        score: probs[maxIdx],
        confidence: calculateConfidence(probs),
        probs,
      },
      featuresUsed: features,
      modelVersion: `${model.version}_fallback`,
    };
    
    // Log fallback inference
    logActorInference({
      network,
      actorId,
      modelVersion: fallbackPrediction.modelVersion,
      wasFallback: true,
      features: p35Features,
      result: {
        label: predictedClass,
        confidence: fallbackPrediction.prediction.confidence,
        probabilities: {
          SMART: probs[0],
          NEUTRAL: probs[1],
          NOISY: probs[2],
        },
      },
      latencyMs: Date.now() - startTs,
    });
    
    return fallbackPrediction;
  }
  
  /**
   * Batch predict for multiple actors
   */
  static async batchPredict(
    network: string, 
    actorIds: string[]
  ): Promise<ActorPrediction[]> {
    const results: ActorPrediction[] = [];
    
    for (const actorId of actorIds) {
      const prediction = await this.predict(network, actorId);
      results.push(prediction);
    }
    
    return results;
  }
  
  /**
   * Get top actors by predicted class
   */
  static async getTopByClass(
    network: string,
    targetClass: ActorClass,
    limit: number = 50
  ): Promise<ActorPrediction[]> {
    // Get recent actors with features
    const features = await FeatureActorModel
      .find({ network })
      .sort({ bucketTs: -1 })
      .limit(limit * 3) // fetch more to filter
      .lean();
    
    // Get unique actors (latest feature per actor)
    const uniqueActors = new Map<string, any>();
    for (const f of features) {
      if (!uniqueActors.has(f.actorId)) {
        uniqueActors.set(f.actorId, f);
      }
    }
    
    // Predict and filter
    const predictions: ActorPrediction[] = [];
    
    for (const actorId of uniqueActors.keys()) {
      const pred = await this.predict(network, actorId);
      if (pred.prediction.class === targetClass) {
        predictions.push(pred);
      }
    }
    
    // Sort by score and limit
    return predictions
      .sort((a, b) => b.prediction.score - a.prediction.score)
      .slice(0, limit);
  }
}

export default ActorPredictService;
