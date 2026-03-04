/**
 * Engine ML Scoring Layer (v2)
 * 
 * ML НЕ принимает решение
 * ML помогает rules принимать лучшее решение
 * 
 * Что делает ML:
 * - Predicts decision_confidence_delta (-10 … +10)
 * - Predicts risk_adjustment (-10 … +10)
 * - Predicts conflict_likelihood (0–1)
 * 
 * Что ML НЕ делает:
 * - BUY / SELL
 * - Direction
 * - Override rules
 * 
 * ML = корректор, не мозг
 */
import { EngineFeatureVector, featureVectorToArray } from './engine_feature_extractor.js';

// ============ ML CONFIGURATION ============

export const ML_CONFIG = {
  // Feature flag
  enabled: false, // KILL SWITCH - set to true to enable ML
  
  // Safety caps
  maxConfidenceDelta: 10,
  minConfidenceDelta: -10,
  maxRiskAdjustment: 10,
  minRiskAdjustment: -10,
  
  // Model info
  modelVersion: 'v2.0-stub',
  lastTrainedAt: null as Date | null,
  trainingDataSize: 0,
  
  // Fallback
  fallbackToV1_1: true,
};

// ============ ML SCORING OUTPUT ============

export interface MLScoringOutput {
  enabled: boolean;
  confidenceDelta: number;      // -10 to +10
  riskAdjustment: number;       // -10 to +10
  conflictLikelihood: number;   // 0 to 1
  modelVersion: string;
  computedAt: Date;
}

// ============ STUB ML MODEL ============

/**
 * Stub ML Model (placeholder for future implementation)
 * 
 * Returns neutral adjustments until real model is trained
 */
function stubMLModel(features: number[]): {
  confidenceDelta: number;
  riskAdjustment: number;
  conflictLikelihood: number;
} {
  // For now, return neutral values
  // Real implementation would use trained model
  
  // Simple heuristic based on features (for demonstration)
  // coverage (index 0), distinct_sources (index 5), conflicts_count (index 4)
  const coverage = features[0];
  const distinctSources = features[5];
  const conflictsCount = features[4];
  
  // Very simple rules-based "ML" for demonstration
  let confidenceDelta = 0;
  let riskAdjustment = 0;
  let conflictLikelihood = conflictsCount * 0.3;
  
  // High coverage with multiple sources = slight confidence boost
  if (coverage > 0.7 && distinctSources > 0.5) {
    confidenceDelta = 2;
  }
  
  // Low coverage = risk adjustment
  if (coverage < 0.5) {
    riskAdjustment = 3;
  }
  
  return {
    confidenceDelta: Math.max(-10, Math.min(10, confidenceDelta)),
    riskAdjustment: Math.max(-10, Math.min(10, riskAdjustment)),
    conflictLikelihood: Math.min(1, conflictLikelihood),
  };
}

// ============ ML SCORING FUNCTION ============

/**
 * Calculate ML scoring adjustments
 * 
 * Returns adjustments to be applied by Rules Engine v1.1
 */
export function calculateMLScoring(features: EngineFeatureVector): MLScoringOutput {
  // Check kill switch
  if (!ML_CONFIG.enabled) {
    return {
      enabled: false,
      confidenceDelta: 0,
      riskAdjustment: 0,
      conflictLikelihood: 0,
      modelVersion: 'disabled',
      computedAt: new Date(),
    };
  }
  
  try {
    // Convert features to array
    const featureArray = featureVectorToArray(features);
    
    // Run ML model
    const mlOutput = stubMLModel(featureArray);
    
    // Apply safety caps
    const confidenceDelta = Math.max(
      ML_CONFIG.minConfidenceDelta,
      Math.min(ML_CONFIG.maxConfidenceDelta, mlOutput.confidenceDelta)
    );
    
    const riskAdjustment = Math.max(
      ML_CONFIG.minRiskAdjustment,
      Math.min(ML_CONFIG.maxRiskAdjustment, mlOutput.riskAdjustment)
    );
    
    return {
      enabled: true,
      confidenceDelta,
      riskAdjustment,
      conflictLikelihood: mlOutput.conflictLikelihood,
      modelVersion: ML_CONFIG.modelVersion,
      computedAt: new Date(),
    };
  } catch (error) {
    console.error('[ML Scoring] Error:', error);
    
    // Fallback to neutral
    return {
      enabled: false,
      confidenceDelta: 0,
      riskAdjustment: 0,
      conflictLikelihood: 0,
      modelVersion: 'error-fallback',
      computedAt: new Date(),
    };
  }
}

// ============ ML CONFIG API ============

/**
 * Get current ML configuration
 */
export function getMLConfig() {
  return {
    ...ML_CONFIG,
    status: ML_CONFIG.enabled ? 'active' : 'disabled',
  };
}

/**
 * Toggle ML (for testing/safety)
 */
export function setMLEnabled(enabled: boolean): void {
  ML_CONFIG.enabled = enabled;
  console.log(`[ML Scoring] ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

// ============ FUTURE: TRAINING INTERFACE ============

/**
 * Training data structure (for future ML training)
 */
export interface MLTrainingRecord {
  features: number[];
  labels: {
    decisionStability: number;      // 0-1
    userHelpfulness: number;        // 0-1
    postDecisionCoherence: number;  // 0-1
    conflictReduction: number;      // 0-1
  };
  decisionId: string;
  timestamp: Date;
}

/**
 * Collect training record (stub)
 */
export function collectTrainingRecord(
  features: EngineFeatureVector,
  decisionId: string
): MLTrainingRecord {
  return {
    features: featureVectorToArray(features),
    labels: {
      decisionStability: 0,
      userHelpfulness: 0,
      postDecisionCoherence: 0,
      conflictReduction: 0,
    },
    decisionId,
    timestamp: new Date(),
  };
}
