/**
 * ML Inference Service (P0.8)
 * 
 * Performs ML inference on feature vectors.
 * Output: confidence_modifier ONLY.
 * NO signals. NO decisions. NO recommendations.
 */

import { FeatureVector } from '../../ml_features_v2/types/feature.types.js';
import { buildFeatureVector } from '../../ml_features_v2/builder/index.js';
import { vectorToArray } from '../../ml_features_v2/normalization/index.js';
import { enforceGates, MLBlockedError } from './gate_enforcer.service.js';
import { getActiveModel, ModelType } from '../storage/ml_model.model.js';
import { logInference, IInferenceOutput } from '../storage/ml_inference_log.model.js';
import crypto from 'crypto';

// ============================================
// Types
// ============================================

export interface InferenceRequest {
  entityType: 'WALLET' | 'TOKEN' | 'ACTOR';
  entityId: string;
  windowHours?: number;
  featureVector?: FeatureVector; // Optional pre-built vector
  requestSource?: string;
}

export interface InferenceResult {
  success: boolean;
  inferenceId: string;
  
  // Output (only if success)
  confidenceModifier?: number;
  calibrationOk?: boolean;
  modelVersion?: string;
  
  // Gate info
  gatesPassed: boolean;
  gatesBlockedBy?: string[];
  
  // Meta
  durationMs: number;
  error?: string;
}

// ============================================
// Inference Service
// ============================================

/**
 * Run inference for an entity
 */
export async function runInference(request: InferenceRequest): Promise<InferenceResult> {
  const startTime = Date.now();
  let vector: FeatureVector | undefined;
  let gateResult: Awaited<ReturnType<typeof enforceGates>> | undefined;
  
  try {
    // 1. Get or build feature vector
    if (request.featureVector) {
      vector = request.featureVector;
    } else {
      const hours = request.windowHours || 24;
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd.getTime() - hours * 60 * 60 * 1000);
      
      const buildResult = await buildFeatureVector(
        {
          entityType: request.entityType,
          entityId: request.entityId,
          windowStart,
          windowEnd
        },
        { normalize: true, skipMarket: true }
      );
      vector = buildResult.vector;
    }
    
    // 2. Enforce quality gates
    gateResult = await enforceGates(vector);
    
    // 3. Get active model
    const model = await getActiveModel('CONFIDENCE_MODIFIER');
    
    if (!model) {
      // No active model - return neutral
      const inferenceLog = await logInference({
        modelId: 'NONE',
        modelVersion: 'N/A',
        input: {
          entityType: request.entityType,
          entityId: request.entityId,
          coveragePercent: vector.coverage?.coveragePercent || 0,
          qualityScore: gateResult.gateResult.decision.score
        },
        gatesPassed: true,
        output: {
          confidenceModifier: 0,
          calibrationOk: true,
          explanation: 'No active model - returning neutral'
        },
        requestedAt: new Date(),
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
        requestSource: request.requestSource
      });
      
      return {
        success: true,
        inferenceId: inferenceLog.inferenceId,
        confidenceModifier: 0,
        calibrationOk: true,
        modelVersion: 'N/A',
        gatesPassed: true,
        durationMs: Date.now() - startTime
      };
    }
    
    // 4. Run inference
    const output = await executeInference(vector, model.modelId);
    
    // 5. Log inference
    const featureHash = generateFeatureHash(vector);
    const inferenceLog = await logInference({
      modelId: model.modelId,
      modelVersion: model.version,
      input: {
        entityType: request.entityType,
        entityId: request.entityId,
        featureHash,
        coveragePercent: vector.coverage?.coveragePercent || 0,
        qualityScore: gateResult.gateResult.decision.score
      },
      gatesPassed: true,
      output,
      requestedAt: new Date(),
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
      requestSource: request.requestSource
    });
    
    return {
      success: true,
      inferenceId: inferenceLog.inferenceId,
      confidenceModifier: output.confidenceModifier,
      calibrationOk: output.calibrationOk,
      modelVersion: model.version,
      gatesPassed: true,
      durationMs: Date.now() - startTime
    };
    
  } catch (error) {
    const durationMs = Date.now() - startTime;
    
    // Handle MLBlockedError specifically
    if (error instanceof MLBlockedError) {
      const inferenceLog = await logInference({
        modelId: 'BLOCKED',
        modelVersion: 'N/A',
        input: {
          entityType: request.entityType,
          entityId: request.entityId,
          coveragePercent: error.coverage * 100,
          qualityScore: error.qualityScore
        },
        gatesPassed: false,
        gatesBlockedBy: error.blockedBy,
        requestedAt: new Date(),
        completedAt: new Date(),
        durationMs,
        requestSource: request.requestSource
      });
      
      return {
        success: false,
        inferenceId: inferenceLog.inferenceId,
        gatesPassed: false,
        gatesBlockedBy: error.blockedBy,
        durationMs,
        error: error.message
      };
    }
    
    // Log other errors
    const inferenceLog = await logInference({
      modelId: 'ERROR',
      modelVersion: 'N/A',
      input: {
        entityType: request.entityType,
        entityId: request.entityId,
        coveragePercent: vector?.coverage?.coveragePercent || 0,
        qualityScore: 0
      },
      gatesPassed: gateResult?.allowed || false,
      requestedAt: new Date(),
      completedAt: new Date(),
      durationMs,
      error: (error as Error).message,
      requestSource: request.requestSource
    });
    
    return {
      success: false,
      inferenceId: inferenceLog.inferenceId,
      gatesPassed: gateResult?.allowed || false,
      durationMs,
      error: (error as Error).message
    };
  }
}

/**
 * Execute actual inference
 * NOTE: This is a simulation. Real implementation would call Python ML service.
 */
async function executeInference(
  vector: FeatureVector,
  modelId: string
): Promise<IInferenceOutput> {
  // Convert to array
  const features = vectorToArray(vector);
  
  // Simulate inference
  // In production, this would call Python ML service
  
  // Calculate confidence modifier based on features
  // This is a simplified heuristic for demonstration
  let modifier = 0;
  
  // Route features influence
  const routeFeatures = vector.routes || {};
  if (routeFeatures.route_exitProbability !== null && routeFeatures.route_exitProbability !== undefined) {
    modifier -= (routeFeatures.route_exitProbability as number) * 0.1;
  }
  if (routeFeatures.route_dumpRiskScore !== null && routeFeatures.route_dumpRiskScore !== undefined) {
    modifier -= (routeFeatures.route_dumpRiskScore as number) * 0.05;
  }
  if (routeFeatures.route_cexTouched) {
    modifier -= 0.02;
  }
  
  // DEX features influence
  const dexFeatures = vector.dex || {};
  if (dexFeatures.dex_swapBeforeExit) {
    modifier -= 0.03;
  }
  if (dexFeatures.dex_activityScore !== null && dexFeatures.dex_activityScore !== undefined) {
    // High activity is slightly positive
    modifier += (dexFeatures.dex_activityScore as number) * 0.02;
  }
  
  // Coverage bonus - higher coverage = more confident
  const coverage = (vector.coverage?.coveragePercent || 0) / 100;
  modifier *= coverage;
  
  // Clamp to reasonable range
  modifier = Math.max(-0.5, Math.min(0.5, modifier));
  modifier = Math.round(modifier * 1000) / 1000;
  
  // Calibration check
  const calibrationOk = coverage >= 0.5 && Math.abs(modifier) < 0.4;
  
  return {
    confidenceModifier: modifier,
    calibrationOk,
    rawScore: modifier,
    explanation: calibrationOk 
      ? 'Inference completed with good calibration'
      : 'Inference completed but calibration may be unreliable'
  };
}

/**
 * Batch inference for multiple entities
 */
export async function runBatchInference(
  requests: InferenceRequest[]
): Promise<InferenceResult[]> {
  const results: InferenceResult[] = [];
  
  // Process in batches of 10
  const batchSize = 10;
  
  for (let i = 0; i < requests.length; i += batchSize) {
    const batch = requests.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(r => runInference(r)));
    results.push(...batchResults);
  }
  
  return results;
}

// ============================================
// Helpers
// ============================================

function generateFeatureHash(vector: FeatureVector): string {
  const features = vectorToArray(vector);
  const data = features.join(',');
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}
